import { describe, expect, it } from "vitest";
import { buildGroups, docsIssuedSince, matchesItem, newDocsSince, runAlerts, type ChangeEntry, type NewDoc, type WatchRow } from "../src/lib/alerts";
import { digestEmail, resetEmail, verifyEmail } from "../src/lib/email";
import { normalizeQuery, queryTerms, matchesQuery } from "../src/lib/search";
import { extractCadastreIds, getRecords, recordSlug, type Record as Doc, type RegisterId } from "../src/lib/data";
import { companiesInRecord } from "../src/lib/companies";
import { neighborhoodOf } from "../src/lib/places";
import { slugify } from "../src/lib/format";

const act16 = getRecords("act16");
const permits = getRecords("permits");
const withParcel = act16.find((r) => extractCadastreIds(r.scope).length && r.region)!;
const doc = (record: Doc, registerId: RegisterId = "act16"): NewDoc => ({ registerId, record, at: "2026-10-16T08:00:00.000Z" });
const regionItem = (record: Doc): WatchRow => ({ kind: "region", key: slugify(record.region), label: `Район ${record.region}`, url: `/region/${slugify(record.region)}/` });

describe("alert matching", () => {
  it("matches regions, parcels and followed documents on the same parcel", () => {
    const d = doc(withParcel);
    expect(matchesItem(regionItem(withParcel), d)).toBe(true);
    expect(matchesItem({ ...regionItem(withParcel), key: "nyama-takav-rayon" }, d)).toBe(false);
    const parcel = extractCadastreIds(withParcel.scope)[0];
    expect(matchesItem({ kind: "parcel", key: parcel, label: parcel, url: "/" }, d)).toBe(true);
    expect(matchesItem({ kind: "record", key: `act16:${recordSlug(withParcel)}`, label: "", url: "/" }, d)).toBe(true);
  });

  it("matches companies and neighborhoods by slug", () => {
    const withCompany = act16.find((r) => companiesInRecord(r, "act16").length)!;
    const company = companiesInRecord(withCompany, "act16")[0];
    expect(matchesItem({ kind: "company", key: company.slug, label: company.display, url: "/" }, doc(withCompany))).toBe(true);
    const withHood = act16.find((r) => neighborhoodOf(r))!;
    expect(matchesItem({ kind: "neighborhood", key: neighborhoodOf(withHood)!.slug, label: "", url: "/" }, doc(withHood))).toBe(true);
  });

  it("matches saved searches with the same normalisation as the check page", () => {
    expect(normalizeQuery("  „Ул.Кутловица“  ")).toBe("ул. кутловица");
    expect(queryTerms("бул.България 1")).toEqual(["бул.", "българия", "1"]);
    expect(matchesQuery(queryTerms("ул.кутловица"), "сграда на ул. Кутловица 12")).toBe(true);
    expect(matchesQuery([], "anything")).toBe(false);
    const word = withParcel.object.split(/\s+/).find((w) => w.length > 5)!;
    expect(matchesItem({ kind: "search", key: `${word} ${withParcel.region}`, label: "", url: "/" }, doc(withParcel))).toBe(true);
    expect(matchesItem({ kind: "search", key: `${word} несъществуващдума`, label: "", url: "/" }, doc(withParcel))).toBe(false);
  });
});

describe("change log", () => {
  const entries: ChangeEntry[] = [
    { at: "2026-10-01T08:00:00.000Z", act16: [recordSlug(act16[1])] },
    { at: "2026-10-02T08:00:00.000Z", act16: [recordSlug(act16[0]), recordSlug(act16[1]), "0-01011900"], permits: [recordSlug(permits[0])] },
  ];

  it("returns documents added after a time once, skipping unknown slugs", () => {
    expect(newDocsSince("2026-10-01T08:00:00.000Z", entries).map((d) => d.record)).toEqual([act16[0], act16[1], permits[0]]);
    expect(newDocsSince("2026-09-01T00:00:00.000Z", entries)).toHaveLength(3);
    expect(newDocsSince("2026-10-02T08:00:00.000Z", entries)).toHaveLength(0);
  });

  it("lists documents issued since a date, newest first", () => {
    const recent = docsIssuedSince("2026-01-01");
    expect(recent.length).toBeGreaterThan(0);
    const dates = recent.map((d) => d.record.date.split(".").reverse().join("-"));
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates.every((d) => d >= "2026-01-01")).toBe(true);
  });
});

describe("digest grouping", () => {
  it("lists each document once, under the first matching item", () => {
    const d = doc(withParcel);
    const parcel = extractCadastreIds(withParcel.scope)[0];
    const { groups, total } = buildGroups([regionItem(withParcel), { kind: "parcel", key: parcel, label: parcel, url: "/" }], [d]);
    expect(total).toBe(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].docs[0].url).toBe(`https://akt16.org/register/act16/${recordSlug(withParcel)}/`);
  });

  it("caps the email at 40 documents but reports the full total", () => {
    const region = withParcel.region;
    const docs = [...act16, ...permits].filter((r) => r.region === region).slice(0, 60).map((r) => doc(r));
    const { groups, total } = buildGroups([regionItem(withParcel)], docs);
    expect(total).toBe(docs.length);
    expect(groups[0].docs.length).toBe(Math.min(40, docs.length));
  });
});

describe("email templates", () => {
  it("builds verification and reset emails with single-use links", () => {
    expect(verifyEmail("abc_123").text).toContain("https://akt16.org/account/verify/?token=abc_123");
    expect(resetEmail("xyz").html).toContain("https://akt16.org/account/reset/?token=xyz");
  });

  it("escapes user content and adds one-click unsubscribe headers", () => {
    const mail = digestEmail({
      name: "<b>Иван</b>",
      total: 2,
      unsubscribeUrl: "https://akt16.org/api/alerts/unsubscribe/?u=1&t=tok",
      groups: [{ label: "Търсене: „<script>“", url: "https://akt16.org/check/", docs: [] }],
    });
    expect(mail.subject).toMatch(/^2 нови документа: /);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>Иван</b>");
    expect(mail.headers).toEqual({
      "List-Unsubscribe": "<https://akt16.org/api/alerts/unsubscribe/?u=1&t=tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

/* A tiny in-memory stand-in for the D1 statements runAlerts uses. */
interface FakeUser { id: number; email: string; name: string | null; created_at: string; last_alert_at: string | null; unsubscribe_token: string | null; email_alerts: number; email_verified_at: string | null }

function fakeDb(users: FakeUser[], watch: { [userId: number]: WatchRow[] }) {
  const log: { user_id: number; documents: number; error: string | null }[] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => ((args = a), stmt),
        async all() {
          if (sql.startsWith("SELECT id, email")) {
            const [latest] = args as [string];
            return { results: users.filter((u) => u.email_alerts && u.email_verified_at && (!u.last_alert_at || u.last_alert_at < latest)) };
          }
          if (sql.startsWith("SELECT kind, key")) return { results: watch[args[0] as number] ?? [] };
          throw new Error(`unexpected ${sql}`);
        },
        async first() {
          if (sql.startsWith("SELECT unsubscribe_token")) return users.find((u) => u.id === args[0]) ?? null;
          throw new Error(`unexpected ${sql}`);
        },
        async run() {
          if (sql.startsWith("UPDATE users SET last_alert_at")) users.find((u) => u.id === args[1])!.last_alert_at = args[0] as string;
          else if (sql.startsWith("UPDATE users SET unsubscribe_token")) {
            const u = users.find((x) => x.id === args[1])!;
            u.unsubscribe_token ??= args[0] as string;
          } else if (sql.startsWith("INSERT INTO alert_log")) log.push({ user_id: args[0] as number, documents: args[2] as number, error: args[4] as string | null });
          else throw new Error(`unexpected ${sql}`);
          return {};
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, log };
}

describe("daily digest run", () => {
  const entries: ChangeEntry[] = [{ at: "2026-10-16T08:00:00.000Z", act16: [recordSlug(withParcel)] }];
  const user = (id: number, extra: Partial<FakeUser> = {}): FakeUser => ({
    id, email: `u${id}@example.com`, name: null, created_at: "2026-10-01T00:00:00.000Z", last_alert_at: "2026-10-01T00:00:00.000Z",
    unsubscribe_token: null, email_alerts: 1, email_verified_at: "2026-10-01T00:00:00.000Z", ...extra,
  });

  it("emails verified subscribers with matches, skips the rest and does not repeat", async () => {
    const users = [user(1), user(2), user(3, { email_verified_at: null }), user(4, { email_alerts: 0 })];
    const watch = { 1: [regionItem(withParcel)], 2: [{ kind: "region", key: "nyama-takav", label: "x", url: "/" }], 3: [regionItem(withParcel)], 4: [regionItem(withParcel)] };
    const { db, log } = fakeDb(users, watch);
    const sent: { to: string; headers?: Record<string, string> }[] = [];
    const env = { DB: db, EMAIL: { send: async (m: Record<string, unknown>) => (sent.push(m as never), { messageId: "m1" }) } };

    expect(await runAlerts(env, entries)).toEqual({ users: 2, sent: 1, skipped: 1, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["u1@example.com"]);
    expect(sent[0].headers?.["List-Unsubscribe"]).toContain(`u=1&t=${users[0].unsubscribe_token}`);
    expect(log).toEqual([{ user_id: 1, documents: 1, error: null }]);
    expect(users[1].last_alert_at).toBe(entries[0].at);
    expect(users[2].last_alert_at).toBe("2026-10-01T00:00:00.000Z");

    expect(await runAlerts(env, entries)).toEqual({ users: 0, sent: 0, skipped: 0, failed: 0 });
  });

  it("stops without losing alerts when the sending domain is not ready", async () => {
    const users = [user(1), user(2)];
    const { db } = fakeDb(users, { 1: [regionItem(withParcel)], 2: [regionItem(withParcel)] });
    const env = { DB: db, EMAIL: { send: async () => { throw Object.assign(new Error("not verified"), { code: "E_SENDER_NOT_VERIFIED" }); } } };
    expect(await runAlerts(env, entries)).toEqual({ users: 1, sent: 0, skipped: 0, failed: 1, stopped: "E_SENDER_NOT_VERIFIED" });
    expect(users.map((u) => u.last_alert_at)).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  });

  it("does not retry a recipient that cannot receive mail", async () => {
    const users = [user(1)];
    const { db, log } = fakeDb(users, { 1: [regionItem(withParcel)] });
    const env = { DB: db, EMAIL: { send: async () => { throw Object.assign(new Error("suppressed"), { code: "E_RECIPIENT_SUPPRESSED" }); } } };
    expect(await runAlerts(env, entries)).toEqual({ users: 1, sent: 0, skipped: 0, failed: 1 });
    expect(users[0].last_alert_at).toBe(entries[0].at);
    expect(log[0].error).toMatch(/^E_RECIPIENT_SUPPRESSED/);
  });

  it("does nothing without a database, binding or changes", async () => {
    expect((await runAlerts({}, entries)).stopped).toBe("no_db");
    expect((await runAlerts({ DB: fakeDb([], {}).db }, entries)).stopped).toBe("no_email_binding");
    expect((await runAlerts({ DB: fakeDb([], {}).db, EMAIL: { send: async () => ({ messageId: "x" }) } }, [])).stopped).toBe("no_changes");
  });
});
