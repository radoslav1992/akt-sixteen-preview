import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  DUMMY_PASSWORD_HASH,
  InputError,
  USER_COLUMNS,
  checkRateLimit,
  createSession,
  fail,
  handle,
  json,
  parseEmail,
  recordAttempt,
  toUser,
  verifyPassword,
} from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, async ({ db, body, ip, request }) => {
    const email = parseEmail(body.email);
    const password = body.password;
    if (typeof password !== "string" || !password) throw new InputError("Въведете парола.");

    const limited = await checkRateLimit(db, "login", ip, email);
    if (limited) return limited;

    const row = await db
      .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
      .bind(email)
      .first<Record<string, unknown>>();
    // Unknown emails still pay for a hash so response times do not reveal registered addresses.
    const valid = await verifyPassword(password, row ? String(row.password_hash) : DUMMY_PASSWORD_HASH);
    if (!row || !valid) {
      await recordAttempt(db, "login", ip, email);
      return fail(401, "invalid_credentials");
    }

    const user = toUser(row);
    return json({ user }, 200, { "set-cookie": await createSession(db, user.id, request) });
  });
