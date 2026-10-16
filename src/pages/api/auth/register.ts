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

export const prerender = false;

export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, async ({ db, body, ip, request }) => {
    const email = parseEmail(body.email);
    const password = parsePassword(body.password);
    const name = parseName(body.name);

    const limited = await checkRateLimit(db, "register", ip);
    if (limited) return limited;
    await recordAttempt(db, "register", ip, null);

    const row = await db
      .prepare(
        "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?) " +
          `ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
      )
      .bind(email, await hashPassword(password), name, nowIso())
      .first<Record<string, unknown>>();
    if (!row) return fail(409, "email_taken");

    const user = toUser(row);
    return json({ user }, 201, { "set-cookie": await createSession(db, user.id, request) });
  });
