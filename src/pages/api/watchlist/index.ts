import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  WATCHLIST_LIMIT,
  WATCH_COLUMNS,
  fail,
  handle,
  json,
  listWatchlist,
  nowIso,
  parseWatchItem,
  parseWatchKey,
} from "../../../lib/auth";

export const prerender = false;

export const GET: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true }, async ({ db, user }) => json({ items: await listWatchlist(db, user.id) }));

// Upsert: adding an item that is already watched refreshes its label and url.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, body, user }) => {
    const { kind, key, label, url } = parseWatchItem(body);
    let item = await db
      .prepare(
        "INSERT INTO watchlist (user_id, kind, key, label, url, created_at) " +
          "SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COUNT(*) FROM watchlist WHERE user_id = ?1) < ?7 " +
          `ON CONFLICT (user_id, kind, key) DO UPDATE SET label = excluded.label, url = excluded.url RETURNING ${WATCH_COLUMNS}`,
      )
      .bind(user.id, kind, key, label, url, nowIso(), WATCHLIST_LIMIT)
      .first();
    if (!item) {
      // The list is full, but an item that is already on it can still be refreshed.
      item = await db
        .prepare(`UPDATE watchlist SET label = ?, url = ? WHERE user_id = ? AND kind = ? AND key = ? RETURNING ${WATCH_COLUMNS}`)
        .bind(label, url, user.id, kind, key)
        .first();
      if (!item) return fail(400, "limit_reached");
    }
    return json({ item }, 201);
  });

export const DELETE: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, body, user }) => {
    const { kind, key } = parseWatchKey(body);
    await db.prepare("DELETE FROM watchlist WHERE user_id = ? AND kind = ? AND key = ?").bind(user.id, kind, key).run();
    return json({ ok: true });
  });
