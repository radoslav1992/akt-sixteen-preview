import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { checkRateLimit, fail, handle, json, recordAttempt } from "../../../lib/auth";
import { sendVerification } from "../../../lib/account-mail";

export const prerender = false;

export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, user, ip }) => {
    if (user.email_verified) return json({ ok: true, already: true });
    const limited = await checkRateLimit(db, "verify", ip, user.email);
    if (limited) return limited;
    await recordAttempt(db, "verify", ip, user.email);
    const sent = await sendVerification(db, env, user.id, user.email);
    if (!sent.ok) return fail(503, "email_unavailable");
    return json({ ok: true });
  });
