import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { SESSION_COOKIE, clearSessionCookie, handle, hashToken, json, parseCookies } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, {}, async ({ db, request }) => {
    const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
    if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await hashToken(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  });
