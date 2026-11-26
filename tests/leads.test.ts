import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InputError } from "../src/lib/auth";
import { BUSINESS_TYPES, HONEYPOT_FIELD, LEAD_INTERESTS, LEAD_MESSAGES, PRICE_RANGES, handleLeadPost, leadNotification, parseLead, purgeOldLeads, saveLead } from "../src/lib/leads";
import { BUSINESS_PAGE_COPY, recentAdditions } from "../src/lib/business";
import { CONTACT_EMAIL } from "../src/lib/email";
import { getRecords, recordSlug } from "../src/lib/data";
import { applyMigration, fakeMail, freshD1, migrationFiles } from "./helpers/d1";

const URL_ = "https://akt16.org/api/business-lead/";
const valid = { email: "Broker@Example.com", company: "Имоти ООД", business_type: "broker", interests: ["coverage", "export"], districts: "Лозенец, Младост", price_range: "25-50", consent: true };

const jsonPost = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_, { method: "POST", headers: { origin: "https://akt16.org", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const formPost = (fields: Array<[string, string]>, headers: Record<string, string> = {}) =>
  new Request(URL_, { method: "POST", headers: { origin: "https://akt16.org", "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() });
const validForm: Array<[string, string]> = [["email", "form@example.com"], ["company", ""], ["business_type", "furniture"], ["interests", "filters"], ["interests", "weekly"], ["districts", ""], ["price_range", "none"], ["consent", "on"], [HONEYPOT_FIELD, ""]];

let db: D1Database;
let dispose: () => Promise<void>;
const rows = (email: string) => db.prepare("SELECT * FROM business_leads WHERE email = ?").bind(email).all<Record<string, string | null>>().then((r) => r.results);
const count = () => db.prepare("SELECT COUNT(*) AS n FROM business_leads").first<number>("n");

beforeAll(async () => { ({ db, dispose } = await freshD1()); });
afterAll(() => dispose());

describe("migration 0003 on a fresh local D1", () => {
  it("applies after 0001 and 0002, keeps rate-limit rows and adds the lead kind", async () => {
    expect(migrationFiles()).toEqual(["0001_init.sql", "0002_email.sql", "0003_business_leads.sql"]);
    const old = await freshD1(2);
    try {
      await old.db.prepare("INSERT INTO auth_attempts (kind, ip, email, created_at) VALUES ('login', '1.2.3.4', 'a@b.bg', '2026-11-01T00:00:00.000Z')").run();
      await expect(old.db.prepare("INSERT INTO auth_attempts (kind, ip, created_at) VALUES ('lead', '1.2.3.4', 'x')").run()).rejects.toThrow(/CHECK/);
      await applyMigration(old.db, "0003_business_leads.sql");
      expect(await old.db.prepare("SELECT kind, ip, email FROM auth_attempts").all().then((r) => r.results)).toEqual([{ kind: "login", ip: "1.2.3.4", email: "a@b.bg" }]);
      await old.db.prepare("INSERT INTO auth_attempts (kind, ip, created_at) VALUES ('lead', '1.2.3.4', 'x')").run();
      await expect(old.db.prepare("INSERT INTO auth_attempts (kind, ip, created_at) VALUES ('other', '1.2.3.4', 'x')").run()).rejects.toThrow(/CHECK/);
      const indexes = await old.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'auth_attempts' ORDER BY name").all<{ name: string }>();
      expect(indexes.results.map((i) => i.name)).toEqual(["auth_attempts_created_at", "auth_attempts_email", "auth_attempts_ip"]);
    } finally {
      await old.dispose();
    }
  });

  it("creates business_leads with a case-insensitive unique email", async () => {
    const columns = await db.prepare("SELECT name FROM pragma_table_info('business_leads') ORDER BY cid").all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toEqual(["id", "email", "company", "business_type", "interests", "districts", "price_range", "consent_at", "created_at", "updated_at"]);
    const insert = (email: string) => db.prepare("INSERT INTO business_leads (email, business_type, price_range, consent_at, created_at, updated_at) VALUES (?, 'other', 'none', 'x', 'x', 'x')").bind(email).run();
    await insert("unique@example.com");
    await expect(insert("UNIQUE@example.com")).rejects.toThrow(/UNIQUE/);
    await db.prepare("DELETE FROM business_leads").run();
  });
});

describe("lead validation", () => {
  it("normalises a complete submission", () => {
    expect(parseLead({ ...valid, company: "  Имоти   ООД ", interests: ["export", "coverage"], districts: "Лозенец,\nМладост" })).toEqual({
      email: "broker@example.com", company: "Имоти ООД", businessType: "broker", interests: ["coverage", "export"], districts: "Лозенец, Младост", priceRange: "25-50",
    });
    expect(parseLead({ email: "a@b.bg", business_type: "other", price_range: "none", consent: "on", interests: "weekly" })).toEqual({
      email: "a@b.bg", company: null, businessType: "other", interests: ["weekly"], districts: null, priceRange: "none",
    });
  });

  it("rejects bad emails, unknown options, long text and a missing consent", () => {
    for (const bad of [
      { email: "not-an-email" }, { email: undefined }, { business_type: "landlord" }, { business_type: undefined }, { price_range: "1000" }, { price_range: "" },
      { interests: ["coverage", "everything"] }, { interests: [1] }, { company: "x".repeat(121) }, { company: 5 }, { districts: "x".repeat(301) },
      { consent: false }, { consent: undefined }, { consent: "off" },
    ]) expect(() => parseLead({ ...valid, ...bad }), JSON.stringify(bad)).toThrow(InputError);
  });

  it("offers every option the brief lists, including „не бих платил“", () => {
    expect(BUSINESS_TYPES.map((t) => t.id)).toEqual(["broker", "credit", "utilities", "furniture", "finishing", "investor", "other"]);
    expect(LEAD_INTERESTS.map((t) => t.id)).toEqual(["coverage", "filters", "weekly", "export"]);
    expect(PRICE_RANGES[0]).toEqual({ id: "none", label: "Не бих платил" });
    expect(PRICE_RANGES.length).toBeGreaterThan(4);
  });
});

describe("POST /api/business-lead/", () => {
  it("stores a JSON submission and answers in the API's JSON shape", async () => {
    const res = await handleLeadPost(jsonPost(valid), { db, ip: "10.0.0.1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: LEAD_MESSAGES.ok });
    const [row] = await rows("broker@example.com");
    expect(row).toMatchObject({ email: "broker@example.com", company: "Имоти ООД", business_type: "broker", interests: "coverage,export", districts: "Лозенец, Младост", price_range: "25-50" });
    expect(row.consent_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(row.created_at).toBe(row.updated_at);
  });

  it("stores a plain form post and redirects back to the page with the result", async () => {
    const res = await handleLeadPost(formPost(validForm), { db, ip: "10.0.0.2" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/business/#lead-ok");
    expect((await rows("form@example.com"))[0]).toMatchObject({ company: null, business_type: "furniture", interests: "filters,weekly", districts: null, price_range: "none" });
  });

  it("answers invalid input with 400 and a message, or a redirect to #lead-invalid, and stores nothing", async () => {
    const before = await count();
    const res = await handleLeadPost(jsonPost({ ...valid, email: "x@y.bg", consent: false }), { db, ip: "10.0.0.3" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input", message: "Отбележете съгласието, за да изпратим формата." });
    expect((await handleLeadPost(jsonPost([1, 2]), { db, ip: "10.0.0.3" })).status).toBe(400);
    expect((await handleLeadPost(new Request(URL_, { method: "POST", headers: { origin: "https://akt16.org", "content-type": "application/json" }, body: "{" }), { db, ip: "10.0.0.3" })).status).toBe(400);
    const form = await handleLeadPost(formPost(validForm.filter(([k]) => k !== "consent")), { db, ip: "10.0.0.3" });
    expect([form.status, form.headers.get("location")]).toEqual([303, "/business/#lead-invalid"]);
    const big = await handleLeadPost(jsonPost({ ...valid, districts: "x".repeat(20000) }), { db, ip: "10.0.0.3" });
    expect(big.status).toBe(413);
    expect(await count()).toBe(before);
    // Rejected submissions do not use up the rate limit.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE ip = '10.0.0.3'").first<number>("n")).toBe(0);
  });

  it("pretends to accept a filled honeypot but stores nothing", async () => {
    const before = await count();
    const res = await handleLeadPost(jsonPost({ ...valid, email: "bot@example.com", [HONEYPOT_FIELD]: "https://spam.example" }), { db, ip: "10.0.0.4" });
    expect([res.status, (await res.json()).ok]).toEqual([200, true]);
    const form = await handleLeadPost(formPost([...validForm.filter(([k]) => k !== HONEYPOT_FIELD && k !== "email"), ["email", "bot2@example.com"], [HONEYPOT_FIELD, "x"]]), { db, ip: "10.0.0.4" });
    expect(form.headers.get("location")).toBe("/business/#lead-ok");
    expect(await count()).toBe(before);
    expect(await rows("bot@example.com")).toEqual([]);
  });

  it("rejects cross-site and origin-less posts", async () => {
    const before = await count();
    for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }]) {
      const res = await handleLeadPost(jsonPost({ ...valid, email: "csrf@example.com" }, headers), { db, ip: "10.0.0.5" });
      expect(res.status).toBe(403);
    }
    const noOrigin = new Request(URL_, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(validForm).toString() });
    expect((await handleLeadPost(noOrigin, { db, ip: "10.0.0.5" })).status).toBe(403);
    expect(await count()).toBe(before);
  });

  it("updates the row when the same email submits again, and notifies the owner only for a new lead", async () => {
    const mail = fakeMail();
    const deps = { db, ip: "10.0.0.6", mail: mail.env };
    expect((await handleLeadPost(jsonPost({ ...valid, email: "repeat@example.com" }), deps)).status).toBe(200);
    const [first] = await rows("repeat@example.com");
    await new Promise((r) => setTimeout(r, 5));
    expect((await handleLeadPost(jsonPost({ ...valid, email: "REPEAT@example.com", company: "", business_type: "investor", interests: [], price_range: "gt100" }), deps)).status).toBe(200);
    const all = await rows("repeat@example.com");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first.id, company: null, business_type: "investor", interests: "", price_range: "gt100", created_at: first.created_at });
    expect(all[0].updated_at! > first.updated_at!).toBe(true);
    expect(all[0].consent_at).toBe(all[0].updated_at);

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: CONTACT_EMAIL, replyTo: "repeat@example.com" });
    expect(mail.sent[0].subject).toContain("Брокер");
    expect(mail.sent[0].text).toContain("repeat@example.com");
  });

  it("still succeeds when the notification cannot be sent", async () => {
    const env = { EMAIL: { send: async () => { throw Object.assign(new Error("not verified"), { code: "E_SENDER_NOT_VERIFIED" }); } } };
    const res = await handleLeadPost(jsonPost({ ...valid, email: "nomail@example.com" }), { db, ip: "10.0.0.7", mail: env });
    expect(res.status).toBe(200);
    expect(await rows("nomail@example.com")).toHaveLength(1);
  });

  it("limits submissions to five an hour per address", async () => {
    const send = (n: number, ip: string, json = true) => {
      const body = { ...valid, email: `limit${n}@example.com` };
      return handleLeadPost(json ? jsonPost(body) : formPost([...validForm.filter(([k]) => k !== "email"), ["email", body.email]]), { db, ip });
    };
    for (let n = 1; n <= 5; n++) expect((await send(n, "10.0.0.8")).status).toBe(200);
    const sixth = await send(6, "10.0.0.8");
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBe("3600");
    expect((await sixth.json()).error).toBe("rate_limited");
    expect((await send(7, "10.0.0.8", false)).headers.get("location")).toBe("/business/#lead-limit");
    expect(await rows("limit6@example.com")).toEqual([]);
    expect((await send(8, "10.0.0.9")).status).toBe(200);
  });

  it("fails politely without a database or before the migration is applied", async () => {
    const none = await handleLeadPost(jsonPost(valid), { db: undefined, ip: "10.0.0.10" });
    expect([none.status, (await none.json()).message]).toEqual([503, LEAD_MESSAGES.error]);
    const old = await freshD1(2);
    try {
      const res = await handleLeadPost(jsonPost(valid), { db: old.db, ip: "10.0.0.10" });
      expect([res.status, (await res.json()).error]).toEqual([500, "server_error"]);
      const form = await handleLeadPost(formPost(validForm), { db: old.db, ip: "10.0.0.10" });
      expect(form.headers.get("location")).toBe("/business/#lead-error");
    } finally {
      await old.dispose();
    }
  });
});

describe("lead storage", () => {
  it("deletes leads 12 months after their last submission", async () => {
    const lead = parseLead(valid);
    const now = Date.parse("2026-11-26T10:00:00.000Z");
    await saveLead(db, { ...lead, email: "old@example.com" }, "2025-11-25T10:00:00.000Z");
    await saveLead(db, { ...lead, email: "recent@example.com" }, "2025-11-27T10:00:00.000Z");
    // Submitted long ago, then again recently: the clock restarts.
    await saveLead(db, { ...lead, email: "renewed@example.com" }, "2025-01-01T10:00:00.000Z");
    expect(await saveLead(db, { ...lead, email: "renewed@example.com" }, "2026-06-01T10:00:00.000Z")).toEqual({ created: false });
    expect(await purgeOldLeads(db, now)).toBe(1);
    expect(await rows("old@example.com")).toEqual([]);
    expect(await rows("recent@example.com")).toHaveLength(1);
    expect((await rows("renewed@example.com"))[0].created_at).toBe("2025-01-01T10:00:00.000Z");
  });

  it("escapes what people type in the owner notification", () => {
    const mail = leadNotification({ ...parseLead(valid), company: '<img src=x onerror="alert(1)">' });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.to).toBe("info@akt16.org");
  });
});

describe("/business/ page data", () => {
  it("keeps the title within 60 characters and the description within 120–155", () => {
    expect([...BUSINESS_PAGE_COPY.title].length).toBeLessThanOrEqual(60);
    expect([...BUSINESS_PAGE_COPY.description].length).toBeGreaterThanOrEqual(120);
    expect([...BUSINESS_PAGE_COPY.description].length).toBeLessThanOrEqual(155);
    expect(BUSINESS_PAGE_COPY.heading).toContain("За бизнеса");
  });

  it("counts what the scrapes added in the last 30 days from the change log", () => {
    const act16 = getRecords("act16");
    const permits = getRecords("permits");
    const entries = [
      { at: "2026-09-01T08:00:00.000Z", act16: [recordSlug(act16[5])] }, // older than 30 days: not counted
      { at: "2026-10-20T08:00:00.000Z", act16: [recordSlug(act16[0]), recordSlug(act16[1])], permits: [recordSlug(permits[0])] },
      { at: "2026-11-01T08:00:00.000Z", permits: [recordSlug(permits[1]), recordSlug(permits[0]), "0-01011900"] },
    ];
    const recent = recentAdditions(30, entries);
    expect([recent.days, recent.act16, recent.permits]).toEqual([30, 2, 2]);
    expect(recent.districts).toBeGreaterThan(0);
    expect(recentAdditions(30, [])).toMatchObject({ permits: 0, act16: 0, sample: [] });

    // On the real change log: a company-only sample of permits for new apartment buildings.
    const real = recentAdditions(30);
    expect(real.permits + real.act16).toBeGreaterThan(0);
    expect(real.sample.length).toBeLessThanOrEqual(5);
    for (const s of real.sample) expect([s.registerId, !!s.company]).toEqual(["permits", true]);
  });
});
