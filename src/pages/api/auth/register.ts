import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  USER_COLUMNS,
  checkRateLimit,
  createSession,
  fail,
  handle,
  hashPassword,
  json,
  nowIso,
  parseEmail,
  parseName,
  parsePassword,
  recordAttempt,
  toUser,
} from "../../../lib/auth";
import { background, sendVerification } from "../../../lib/account-mail";

export const prerender = false;

// Body: {email, password, name?, email_alerts?}. Alerts default to on; they start once the email is verified.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, async ({ db, body, ip, request }) => {
    const email = parseEmail(body.email);
    const password = parsePassword(body.password);
    const name = parseName(body.name);
    const alerts = body.email_alerts === undefined ? true : Boolean(body.email_alerts);

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
    background(ctx.locals, sendVerification(db, env, user.id, user.email));
    return json({ user }, 201, { "set-cookie": await createSession(db, user.id, request) });
  });
