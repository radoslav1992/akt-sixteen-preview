import { defineMiddleware } from "astro:middleware";

// Runs for pages rendered by the worker (documents, registers, API). Static pages are served
// directly by Cloudflare, so enable "Always Use HTTPS" in the dashboard to cover them as well.
export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.isPrerendered) {
    const url = new URL(context.request.url);
    const proto = context.request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    if (proto === "http" && url.hostname === "akt16.org") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
  }
  const response = await next();
  if (!context.isPrerendered) {
    try {
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      if (!response.headers.has("X-Frame-Options")) response.headers.set("X-Frame-Options", "SAMEORIGIN");
    } catch {
      // Some responses (e.g. proxied assets) have immutable headers.
    }
  }
  return response;
});
