// Account creation and email verification, kept out of the route files so they can be tested against
// a real D1 database (tests/signup-flow.test.ts).
import {
  InputError,
  USER_COLUMNS,
  checkRateLimit,
  consumeEmailToken,
  createSession,
  fail,
  hashPassword,
  json,
  nowIso,
  parseEmail,
  parseName,
  parsePassword,
  parseWatchItem,
  recordAttempt,
  toUser,
  type HandlerContext,
  type WatchItem,
} from "./auth";

/**
 * Body: {email, password, name?, email_alerts?, follow?}. Alerts default to on; they start once the email
 * is verified. `follow` is the item the visitor pressed „Извести ме по имейл“ on before they had an
 * account: it goes on the new account's watchlist straight away, so the alert does not depend on the
 * browser syncing its local list afterwards.
 */
export async function registerAccount(
  { db, body, ip, request }: Pick<HandlerContext, "db" | "body" | "ip" | "request">,
  sendVerification: (userId: number, email: string) => void,
): Promise<Response> {
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  const name = parseName(body.name);
  const alerts = body.email_alerts === undefined ? true : Boolean(body.email_alerts);
  let follow: WatchItem | null = null;
  try {
    if (body.follow !== undefined && body.follow !== null) follow = parseWatchItem(body.follow);
  } catch (err) {
    // A malformed item must not block the registration itself.
    if (!(err instanceof InputError)) throw err;
  }

  const limited = await checkRateLimit(db, "register", ip);
  if (limited) return limited;
  await recordAttempt(db, "register", ip, null);

  const now = nowIso();
  const row = await db
    .prepare(
      "INSERT INTO users (email, password_hash, name, created_at, email_alerts, last_alert_at) VALUES (?, ?, ?, ?, ?, ?) " +
        `ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
    )
    .bind(email, await hashPassword(password), name, now, alerts ? 1 : 0, now)
    .first<Record<string, unknown>>();
  if (!row) return fail(409, "email_taken");

  const user = toUser(row);
  if (follow) {
    await db
      .prepare("INSERT INTO watchlist (user_id, kind, key, label, url, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(user.id, follow.kind, follow.key, follow.label, follow.url, now)
      .run();
  }
  sendVerification(user.id, user.email);
  return json({ user, followed: !!follow }, 201, { "set-cookie": await createSession(db, user.id, request) });
}

/**
 * Body: {token} from the verification email. No session needed: the token proves ownership of the address.
 * The answer says whether alerts are on and how many items are followed, so the page can confirm what
 * the visitor will receive even when the link is opened on another device.
 */
export async function verifyAccountEmail(db: D1Database, token: unknown): Promise<Response> {
  const userId = await consumeEmailToken(db, token, "verify");
  if (!userId) return fail(400, "invalid_token");
  const row = await db
    .prepare(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? " +
        "RETURNING email_alerts, (SELECT COUNT(*) FROM watchlist WHERE user_id = users.id) AS following",
    )
    .bind(nowIso(), userId)
    .first<{ email_alerts: number; following: number }>();
  return json({ ok: true, email_alerts: Boolean(row?.email_alerts), following: Number(row?.following ?? 0) });
}
