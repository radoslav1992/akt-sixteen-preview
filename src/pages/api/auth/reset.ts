import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { USER_COLUMNS, consumeEmailToken, createSession, fail, handle, hashPassword, json, nowIso, parsePassword, toUser } from "../../../lib/auth";

export const prerender = false;

// Body: {token, password}. Sets the new password, signs out every other session and signs this browser in.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, async ({ db, body, request }) => {
    const password = parsePassword(body.password);
    const userId = await consumeEmailToken(db, body.token, "reset");
    if (!userId) return fail(400, "invalid_token");
    const [, , updated] = await db.batch([
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
      db.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL").bind(nowIso(), userId),
      // Following the emailed link also proves the address.
      db
        .prepare(`UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? RETURNING ${USER_COLUMNS}`)
        .bind(await hashPassword(password), nowIso(), userId),
    ]);
    const row = (updated.results as Record<string, unknown>[])[0];
    if (!row) return fail(400, "invalid_token");
    return json({ user: toUser(row) }, 200, { "set-cookie": await createSession(db, userId, request) });
  });
