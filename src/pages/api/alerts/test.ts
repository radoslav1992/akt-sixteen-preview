import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { checkRateLimit, fail, handle, json, nowIso, recordAttempt } from "../../../lib/auth";
import { buildGroups, docsIssuedSince, ensureUnsubscribeToken, toDigestDoc, unsubscribeUrl, type WatchRow } from "../../../lib/alerts";
import { digestEmail, sendMail } from "../../../lib/email";
import { getRecords } from "../../../lib/data";
import { SITE_URL } from "../../../lib/seo";

export const prerender = false;

// Sends the signed-in user a sample digest: documents issued in the last 30 days that match the
// watchlist, or the newest documents if nothing matches.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, user, ip }) => {
    if (!user.email_verified) return fail(403, "email_unverified");
    const limited = await checkRateLimit(db, "alert_test", ip, user.email);
    if (limited) return limited;
    await recordAttempt(db, "alert_test", ip, user.email);

    const { results: items } = await db.prepare("SELECT kind, key, label, url FROM watchlist WHERE user_id = ? ORDER BY created_at").bind(user.id).all<WatchRow>();
    let { groups, total } = buildGroups(items, docsIssuedSince(nowIso(-30 * 24 * 60 * 60).slice(0, 10)));
    if (!total) {
      const latest = [
        ...getRecords("act16").slice(0, 3).map((record) => ({ registerId: "act16" as const, record, at: "" })),
        ...getRecords("permits").slice(0, 2).map((record) => ({ registerId: "permits" as const, record, at: "" })),
      ];
      groups = [{ label: "Примерни нови документи в София", url: `${SITE_URL}/register/act16/`, docs: latest.map(toDigestDoc) }];
      total = latest.length;
    }
    const row = await db.prepare("SELECT unsubscribe_token FROM users WHERE id = ?").bind(user.id).first<{ unsubscribe_token: string | null }>();
    const token = await ensureUnsubscribeToken(db, user.id, row?.unsubscribe_token ?? null);
    const mail = digestEmail({ name: user.name, groups, total, unsubscribeUrl: unsubscribeUrl(user.id, token), test: true });
    const sent = await sendMail(env, { to: user.email, ...mail });
    await db
      .prepare("INSERT INTO alert_log (user_id, sent_at, kind, documents, message_id, error) VALUES (?, ?, 'test', ?, ?, ?)")
      .bind(user.id, nowIso(), total, sent.ok ? sent.id : null, sent.ok ? null : `${sent.code}: ${sent.message}`.slice(0, 300))
      .run();
    if (!sent.ok) return fail(503, "email_unavailable");
    return json({ ok: true, documents: total });
  });
