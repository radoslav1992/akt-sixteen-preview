// D1 binding used by the /api/auth and /api/watchlist routes (see wrangler.jsonc).
// `npm run generate-types` writes worker-configuration.d.ts with the full Workers
// runtime types (D1Database, the "cloudflare:workers" module) that this relies on.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
