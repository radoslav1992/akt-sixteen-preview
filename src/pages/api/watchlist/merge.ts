import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  InputError,
  MERGE_LIMIT,
  WATCHLIST_LIMIT,
  handle,
  json,
  listWatchlist,
  nowIso,
  parseWatchItem,
  type WatchItem,
} from "../../../lib/auth";

export const prerender = false;

// Keeps a client-supplied created_at only if it is a plausible past date.
function pastDate(value: unknown): string | null {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return ms > Date.UTC(2020, 0, 1) && ms <= Date.now() ? new Date(ms).toISOString() : null;
}

// Merges an anonymous (localStorage) watchlist after sign-in. Items already on the
// account are left untouched, invalid items are skipped and the list cap still applies.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, body, user }) => {
    if (!Array.isArray(body.items) || body.items.length > MERGE_LIMIT) {
      throw new InputError(`Очаква се списък с до ${MERGE_LIMIT} записа.`);
    }
    const now = nowIso();
    const items = new Map<string, WatchItem & { created_at: string }>();
    for (const raw of body.items) {
      try {
        const item = parseWatchItem(raw);
        const id = `${item.kind}\n${item.key}`;
        if (!items.has(id)) items.set(id, { ...item, created_at: pastDate(raw.created_at) ?? now });
      } catch (err) {
        if (!(err instanceof InputError)) throw err;
      }
    }

    if (items.size) {
      const count = await db.prepare("SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?").bind(user.id).first<number>("n");
      const room = WATCHLIST_LIMIT - (count ?? 0);
      if (room > 0) {
        await db
          .prepare(
            "INSERT INTO watchlist (user_id, kind, key, label, url, created_at) " +
              "SELECT ?1, j.value ->> 'kind', j.value ->> 'key', j.value ->> 'label', j.value ->> 'url', j.value ->> 'created_at' " +
              "FROM json_each(?2) AS j WHERE NOT EXISTS (SELECT 1 FROM watchlist w " +
              "WHERE w.user_id = ?1 AND w.kind = j.value ->> 'kind' AND w.key = j.value ->> 'key') " +
              "LIMIT ?3 ON CONFLICT DO NOTHING",
          )
          .bind(user.id, JSON.stringify([...items.values()]), room)
          .run();
      }
    }
    return json({ items: await listWatchlist(db, user.id) });
  });
