// Daily email digests: documents that the scraper newly added (data/changes.json) are matched
// against each subscriber's watchlist. Runs from the worker's cron trigger (src/worker.ts).
import changes from "../../data/changes.json";
import { findRecordBySlug, extractCadastreIds, getRecords, parcelIdOf, recordSlug, type Record, type RegisterId } from "./data";
import { companiesInRecord } from "./companies";
import { neighborhoodOf } from "./places";
import { isoDate, slugify, truncate } from "./format";
import { readableCase } from "./textcase";
import { SITE_URL } from "./seo";
import { matchesQuery, queryTerms } from "./search";
import { digestEmail, sendMail, FATAL_SEND_ERRORS, type DigestDoc, type DigestGroup, type MailEnv } from "./email";
import { newSessionToken, nowIso } from "./auth";

export interface ChangeEntry { at: string; act16?: string[]; permits?: string[] }
export interface WatchRow { kind: string; key: string; label: string; url: string }
export interface NewDoc { registerId: RegisterId; record: Record; at: string }

const MAX_DOCS_PER_EMAIL = 40;
const MAX_USERS_PER_RUN = 2000;

export function changeEntries(): ChangeEntry[] {
  return ((changes as { entries?: ChangeEntry[] }).entries ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
}

export function latestChangeAt(entries = changeEntries()): string | null {
  return entries.length ? entries[entries.length - 1].at : null;
}

/** Documents added by scrape runs after `since` (ISO), oldest run first, without duplicates. */
export function newDocsSince(since: string, entries = changeEntries()): NewDoc[] {
  const seen = new Set<string>();
  const out: NewDoc[] = [];
  for (const entry of entries) {
    if (entry.at <= since) continue;
    for (const registerId of ["act16", "permits"] as RegisterId[]) {
      for (const slug of entry[registerId] ?? []) {
        const key = `${registerId}:${slug}`;
        if (seen.has(key)) continue;
        const record = findRecordBySlug(registerId, slug);
        if (!record) continue;
        seen.add(key);
        out.push({ registerId, record, at: entry.at });
      }
    }
  }
  return out;
}

/** Documents issued on or after `since` (YYYY-MM-DD), newest first: used for test digests before the change log fills up. */
export function docsIssuedSince(since: string): NewDoc[] {
  return (["act16", "permits"] as RegisterId[])
    .flatMap((registerId) => getRecords(registerId).filter((r) => isoDate(r.date) >= since).map((record) => ({ registerId, record, at: "" })))
    .sort((a, b) => isoDate(b.record.date).localeCompare(isoDate(a.record.date)));
}

const parcelsOf = (record: Record) => new Set(extractCadastreIds(record.scope).map(parcelIdOf));

/** Does a newly added document belong to a watched item? */
export function matchesItem(item: WatchRow, doc: NewDoc): boolean {
  const { record, registerId } = doc;
  switch (item.kind) {
    case "region":
      return !!record.region && slugify(record.region) === item.key;
    case "neighborhood":
      return neighborhoodOf(record)?.slug === item.key;
    case "company":
      return companiesInRecord(record, registerId).some((c) => c.slug === item.key);
    case "parcel":
      // Documents are filed under the parcel, building or unit id: compare parcels.
      return parcelsOf(record).has(parcelIdOf(item.key));
    case "record": {
      // A followed document: alert when a later document appears on the same parcel.
      const [reg, slug] = item.key.split(":");
      const followed = findRecordBySlug(reg as RegisterId, slug);
      if (!followed) return false;
      const parcels = parcelsOf(followed);
      return [...parcelsOf(record)].some((id) => parcels.has(id));
    }
    case "search": {
      const text = `${record.number} ${record.object} ${record.region} ${record.scope} ${record.employer} ${record.constructionOversight} ${neighborhoodOf(record)?.name ?? ""}`;
      return matchesQuery(queryTerms(item.key), text);
    }
    default:
      return false;
  }
}

export function toDigestDoc(doc: NewDoc): DigestDoc {
  return {
    register: doc.registerId,
    number: doc.record.number,
    date: doc.record.date,
    title: truncate(readableCase(doc.record.object), 160),
    url: `${SITE_URL}/register/${doc.registerId}/${recordSlug(doc.record)}/`,
    region: doc.record.region,
  };
}

/** Groups matching documents by watched item; a document is listed once, under its first matching item. */
export function buildGroups(items: WatchRow[], docs: NewDoc[]): { groups: DigestGroup[]; total: number } {
  const used = new Set<NewDoc>();
  const groups: DigestGroup[] = [];
  let total = 0;
  for (const item of items) {
    const matched = docs.filter((d) => !used.has(d) && matchesItem(item, d));
    if (!matched.length) continue;
    matched.forEach((d) => used.add(d));
    total += matched.length;
    const room = MAX_DOCS_PER_EMAIL - groups.reduce((n, g) => n + g.docs.length, 0);
    if (room <= 0) continue;
    groups.push({ label: item.label, url: `${SITE_URL}${item.url}`, docs: matched.slice(0, room).map(toDigestDoc) });
  }
  return { groups, total };
}

export function unsubscribeUrl(userId: number, token: string): string {
  return `${SITE_URL}/api/alerts/unsubscribe/?u=${userId}&t=${encodeURIComponent(token)}`;
}

export async function ensureUnsubscribeToken(db: D1Database, userId: number, current: string | null): Promise<string> {
  if (current) return current;
  const token = newSessionToken();
  await db.prepare("UPDATE users SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL").bind(token, userId).run();
  const row = await db.prepare("SELECT unsubscribe_token FROM users WHERE id = ?").bind(userId).first<{ unsubscribe_token: string }>();
  return row?.unsubscribe_token ?? token;
}

interface AlertEnv extends MailEnv { DB?: D1Database }

export interface AlertRunResult { users: number; sent: number; skipped: number; failed: number; stopped?: string }

/** Sends one digest per subscribed, verified user with new matching documents since their last digest. */
export async function runAlerts(env: AlertEnv, entries = changeEntries()): Promise<AlertRunResult> {
  const result: AlertRunResult = { users: 0, sent: 0, skipped: 0, failed: 0 };
  const db = env.DB;
  const latest = latestChangeAt(entries);
  if (!db || !env.EMAIL || !latest) return { ...result, stopped: !db ? "no_db" : !env.EMAIL ? "no_email_binding" : "no_changes" };

  const { results: users } = await db
    .prepare(
      "SELECT id, email, name, created_at, last_alert_at, unsubscribe_token FROM users " +
        "WHERE email_alerts = 1 AND email_verified_at IS NOT NULL AND (last_alert_at IS NULL OR last_alert_at < ?) ORDER BY id LIMIT ?",
    )
    .bind(latest, MAX_USERS_PER_RUN)
    .all<{ id: number; email: string; name: string | null; created_at: string; last_alert_at: string | null; unsubscribe_token: string | null }>();

  for (const user of users) {
    result.users++;
    const docs = newDocsSince(user.last_alert_at ?? user.created_at, entries);
    const { results: items } = docs.length
      ? await db.prepare("SELECT kind, key, label, url FROM watchlist WHERE user_id = ? ORDER BY created_at").bind(user.id).all<WatchRow>()
      : { results: [] as WatchRow[] };
    const { groups, total } = buildGroups(items, docs);

    if (!total) {
      result.skipped++;
      await db.prepare("UPDATE users SET last_alert_at = ? WHERE id = ?").bind(latest, user.id).run();
      continue;
    }

    const token = await ensureUnsubscribeToken(db, user.id, user.unsubscribe_token);
    const mail = digestEmail({ name: user.name, groups, total, unsubscribeUrl: unsubscribeUrl(user.id, token) });
    const sent = await sendMail(env, { to: user.email, ...mail });
    await db
      .prepare("INSERT INTO alert_log (user_id, sent_at, kind, documents, message_id, error) VALUES (?, ?, 'digest', ?, ?, ?)")
      .bind(user.id, nowIso(), total, sent.ok ? sent.id : null, sent.ok ? null : `${sent.code}: ${sent.message}`.slice(0, 300))
      .run();
    if (sent.ok) {
      result.sent++;
      await db.prepare("UPDATE users SET last_alert_at = ? WHERE id = ?").bind(latest, user.id).run();
    } else {
      result.failed++;
      // Domain not onboarded or quota reached: stop and retry tomorrow without losing these alerts.
      if (FATAL_SEND_ERRORS.has(sent.code)) return { ...result, stopped: sent.code };
      // Recipient-specific failures (suppressed, invalid address) would fail again: do not retry forever.
      await db.prepare("UPDATE users SET last_alert_at = ? WHERE id = ?").bind(latest, user.id).run();
    }
  }
  return result;
}
