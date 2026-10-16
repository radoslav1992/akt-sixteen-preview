import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { checkRateLimit, handle, json, parseEmail, recordAttempt } from "../../../lib/auth";
import { background, sendPasswordReset } from "../../../lib/account-mail";

export const prerender = false;

const MESSAGE = "Ако има профил с този имейл, изпратихме връзка за нова парола. Проверете и папката за нежелана поща.";

// Body: {email}. Always answers the same way, so it cannot be used to discover registered addresses.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, async ({ db, body, ip }) => {
    const email = parseEmail(body.email);
    const limited = await checkRateLimit(db, "reset", ip, email);
    if (limited) return limited;
    await recordAttempt(db, "reset", ip, email);
    const user = await db.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<{ id: number; email: string }>();
    if (user) background(ctx.locals, sendPasswordReset(db, env, user.id, user.email));
    return json({ ok: true, message: MESSAGE });
  });
