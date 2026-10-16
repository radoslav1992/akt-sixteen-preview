// Public, CORS-enabled lookup used by the browser extension: GET /api/lookup/?q=&cad=&street=&hood=
// The search itself lives in src/lib/lookup.ts; responses are cached at the edge for an hour.
import type { APIRoute } from "astro";
import { lookup, lookupCacheQuery, parseLookupParams } from "../../lib/lookup";

export const prerender = false;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const params = parseLookupParams(url.searchParams);
  if (!params) {
    return json(
      { error: "empty_query", message: "Подайте поне един от параметрите q, cad, street или hood (до 120 знака)." },
      400,
    );
  }

  const cache: Cache | undefined = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(`${url.origin}/api/lookup/?${lookupCacheQuery(params)}`);
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return hit;
  }

  const response = json(lookup(params));
  if (cache) {
    const put = cache.put(key, response.clone()).catch(() => {});
    const cf = (locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
    if (cf) cf.waitUntil(put);
    else await put;
  }
  return response;
};
