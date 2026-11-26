import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { clientIpKey } from "../../lib/auth";
import { background } from "../../lib/account-mail";
import { handleLeadPost } from "../../lib/leads";

export const prerender = false;

// Interest form on /business/: JSON from the page's script, or a plain form post without JavaScript.
export const POST: APIRoute = (ctx) =>
  handleLeadPost(ctx.request, { db: env.DB, ip: clientIpKey(ctx), mail: env, background: (task) => background(ctx.locals, task) });
