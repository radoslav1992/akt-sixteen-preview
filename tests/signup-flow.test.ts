// Follow → register → verify → daily digest, against a real local D1 with all migrations applied.
// This is the path of a visitor who presses „Извести ме по имейл“ on a district page without an account.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAccount, verifyAccountEmail } from "../src/lib/signup";
import { sendVerification } from "../src/lib/account-mail";
import { runAlerts, type ChangeEntry } from "../src/lib/alerts";
import { getRecords, recordSlug } from "../src/lib/data";
import { slugify } from "../src/lib/format";
import { SESSION_COOKIE, getSessionUser, listWatchlist } from "../src/lib/auth";
import { fakeMail, freshD1 } from "./helpers/d1";

const record = getRecords("act16").find((r) => r.region)!;
const region = { kind: "region", key: slugify(record.region), label: `Район ${record.region}`, url: `/region/${slugify(record.region)}/` };
const request = new Request("https://akt16.org/api/auth/register/", { method: "POST", headers: { "user-agent": "vitest" } });
// A scrape that runs after the registration and adds a certificate in the followed district.
const entries: ChangeEntry[] = [{ at: new Date(Date.now() + 86400000).toISOString(), act16: [recordSlug(record)] }];

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => { ({ db, dispose } = await freshD1()); });
afterAll(() => dispose());

/** Registers through the same function as POST /api/auth/register/ and returns the emailed verification token. */
async function register(body: Record<string, unknown>, ip: string) {
  const mail = fakeMail();
  const pending: Promise<unknown>[] = [];
  const res = await registerAccount({ db, body, ip, request }, (userId, email) => { pending.push(sendVerification(db, mail.env, userId, email)); });
  await Promise.all(pending);
  const token = mail.sent[0]?.text.match(/verify\/\?token=([\w-]+)/)?.[1];
  return { res, data: (await res.json()) as { user?: { id: number; email_alerts: boolean; email_verified: boolean }; followed?: boolean; error?: string }, token, mail };
}
const userRow = (id: number) => db.prepare("SELECT email_alerts, email_verified_at, last_alert_at FROM users WHERE id = ?").bind(id).first<{ email_alerts: number; email_verified_at: string | null; last_alert_at: string | null }>();

describe("follow → register → verify", () => {
  it("puts the clicked item on the new account with alerts on, and the digest starts after verification", async () => {
    const { res, data, token } = await register({ email: "New.User@example.com", password: "парола-123", follow: region }, "10.1.0.1");
    expect(res.status).toBe(201);
    expect(data).toMatchObject({ followed: true, user: { email: "new.user@example.com", email_alerts: true, email_verified: false } });
    const userId = data.user!.id;

    // Signed in straight away, and the item is on the account before any client-side sync.
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect((await getSessionUser(db, new Request("https://akt16.org/", { headers: { cookie } })))?.id).toBe(userId);
    expect(await listWatchlist(db, userId)).toMatchObject([region]);
    expect(await userRow(userId)).toMatchObject({ email_alerts: 1, email_verified_at: null });

    // Not verified yet: no digest, and the documents are not lost.
    const mail = fakeMail();
    expect(await runAlerts({ DB: db, ...mail.env }, entries)).toMatchObject({ users: 0, sent: 0 });

    expect(token).toBeTruthy();
    const verified = await verifyAccountEmail(db, token);
    expect(await verified.json()).toEqual({ ok: true, email_alerts: true, following: 1 });
    expect((await userRow(userId))!.email_verified_at).toMatch(/^\d{4}-/);

    expect(await runAlerts({ DB: db, ...mail.env }, entries)).toMatchObject({ users: 1, sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("new.user@example.com");
    expect(mail.sent[0].subject).toContain(region.label);
    expect(mail.sent[0].text).toContain(`/register/act16/${recordSlug(record)}/`);
    expect(mail.sent[0].headers?.["List-Unsubscribe"]).toContain("/api/alerts/unsubscribe/");
    // One digest per scrape: nothing is repeated.
    expect(await runAlerts({ DB: db, ...mail.env }, entries)).toMatchObject({ users: 0, sent: 0 });
  });

  it("accepts the verification link once", async () => {
    const { token } = await register({ email: "once@example.com", password: "парола-123" }, "10.1.0.2");
    expect((await verifyAccountEmail(db, token)).status).toBe(200);
    const again = await verifyAccountEmail(db, token);
    expect([again.status, ((await again.json()) as { error: string }).error]).toEqual([400, "invalid_token"]);
    expect((await verifyAccountEmail(db, "x".repeat(43))).status).toBe(400);
  });

  it("respects an unticked alerts box but still follows the item", async () => {
    const { data, token } = await register({ email: "quiet@example.com", password: "парола-123", email_alerts: false, follow: region }, "10.1.0.3");
    expect(data.user!.email_alerts).toBe(false);
    expect(await ((await verifyAccountEmail(db, token)).json())).toEqual({ ok: true, email_alerts: false, following: 1 });
    const mail = fakeMail();
    await runAlerts({ DB: db, ...mail.env }, [{ at: new Date(Date.now() + 2 * 86400000).toISOString(), act16: [recordSlug(record)] }]);
    expect(mail.sent.map((m) => m.to)).not.toContain("quiet@example.com");
  });

  it("registers without an item, and ignores a malformed one instead of failing", async () => {
    const plain = await register({ email: "plain@example.com", password: "парола-123" }, "10.1.0.4");
    expect([plain.res.status, plain.data.followed]).toEqual([201, false]);
    expect(await listWatchlist(db, plain.data.user!.id)).toEqual([]);
    const bad = await register({ email: "bad-item@example.com", password: "парола-123", follow: { kind: "region", key: "x", label: "x", url: "https://evil.example/" } }, "10.1.0.4");
    expect([bad.res.status, bad.data.followed]).toEqual([201, false]);
    expect(await listWatchlist(db, bad.data.user!.id)).toEqual([]);
  });

  it("does not create a second account or change the watchlist for a known email", async () => {
    const first = await register({ email: "taken@example.com", password: "парола-123", follow: region }, "10.1.0.5");
    const second = await register({ email: "TAKEN@example.com", password: "друга-парола", follow: { ...region, key: "drug-rayon" } }, "10.1.0.5");
    expect([second.res.status, second.data.error]).toEqual([409, "email_taken"]);
    expect(second.mail.sent).toEqual([]);
    expect(await listWatchlist(db, first.data.user!.id)).toMatchObject([region]);
  });
});
