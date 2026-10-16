import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handle, json, nowIso, parseWatchKey } from "../../../lib/auth";

export const prerender = false;

// Body: {kind, key} for one item or {all: true} for the whole list.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, body, user }) => {
    const now = nowIso();
    let statement;
    if (body.all === true) {
      statement = db.prepare("UPDATE watchlist SET last_seen_at = ? WHERE user_id = ?").bind(now, user.id);
    } else {
      const { kind, key } = parseWatchKey(body);
      statement = db
        .prepare("UPDATE watchlist SET last_seen_at = ? WHERE user_id = ? AND kind = ? AND key = ?")
        .bind(now, user.id, kind, key);
    }
    const { meta } = await statement.run();
    return json({ ok: true, updated: meta.changes, last_seen_at: now });
  });
