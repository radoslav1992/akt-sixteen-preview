import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  InputError,
  checkRateLimit,
  clearSessionCookie,
  fail,
  handle,
  json,
  recordAttempt,
  verifyPassword,
} from "../../../lib/auth";

export const prerender = false;

// Right to erasure: removes the user together with their sessions, watchlist and login attempts.
export const DELETE: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, body, ip, user }) => {
    const password = body.password;
    if (typeof password !== "string" || !password) throw new InputError("Въведете паролата си, за да потвърдите.");

    const limited = await checkRateLimit(db, "login", ip, user.email);
    if (limited) return limited;

    const row = await db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      await recordAttempt(db, "login", ip, user.email);
      return fail(403, "invalid_credentials", "Грешна парола.");
    }

    await db.batch([
      db.prepare("DELETE FROM watchlist WHERE user_id = ?").bind(user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      db.prepare("DELETE FROM email_tokens WHERE user_id = ?").bind(user.id),
      db.prepare("DELETE FROM alert_log WHERE user_id = ?").bind(user.id),
      db.prepare("DELETE FROM auth_attempts WHERE email = ?").bind(user.email),
      db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    ]);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  });
