import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handle } from "../../../lib/auth";
import { verifyAccountEmail } from "../../../lib/signup";

export const prerender = false;

// Body: {token} from the verification email: see verifyAccountEmail.
export const POST: APIRoute = (ctx) => handle(env.DB, ctx, { body: true }, ({ db, body }) => verifyAccountEmail(db, body.token));
