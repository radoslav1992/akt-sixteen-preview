import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handle } from "../../../lib/auth";
import { background, sendVerification } from "../../../lib/account-mail";
import { registerAccount } from "../../../lib/signup";

export const prerender = false;

// Body: {email, password, name?, email_alerts?, follow?}: see registerAccount.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { body: true }, (c) =>
    registerAccount(c, (userId, email) => background(ctx.locals, sendVerification(c.db, env, userId, email))),
  );
