import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  clearSessionCookie,
  getSession,
  handle,
  json,
  nowIso,
  parseCookies,
  sessionCookie,
} from "../../../lib/auth";

export const prerender = false;

export const GET: APIRoute = (ctx) =>
  handle(env.DB, ctx, {}, async ({ db, request }) => {
    const session = await getSession(db, request);
    if (!session) {
      const stale = SESSION_COOKIE in parseCookies(request.headers.get("cookie"));
      return json({ user: null }, 200, stale ? { "set-cookie": clearSessionCookie() } : {});
    }
    // Sliding expiry: once a session is past half its lifetime, extend it to a full 30 days.
    if (Date.parse(session.expiresAt) - Date.now() < (SESSION_MAX_AGE * 1000) / 2) {
      await db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(nowIso(SESSION_MAX_AGE), session.id).run();
      return json({ user: session.user }, 200, { "set-cookie": sessionCookie(session.token) });
    }
    return json({ user: session.user });
  });
