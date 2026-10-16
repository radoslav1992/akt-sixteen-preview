import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { consumeEmailToken, fail, handle, json, nowIso } from "../../../lib/auth";

export const prerender = false;

// Body: {token} from the verification email. No session needed: the token proves ownership of the address.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, async ({ db, body }) => {
    const userId = await consumeEmailToken(db, body.token, "verify");
    if (!userId) return fail(400, "invalid_token");
    await db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").bind(nowIso(), userId).run();
    return json({ ok: true });
  });
