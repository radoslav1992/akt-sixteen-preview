// Bindings declared in wrangler.jsonc. `npm run generate-types` writes worker-configuration.d.ts
// with the full Workers runtime types (D1Database, SendEmail, the "cloudflare:workers" module).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** Cloudflare Email Service binding (send_email). */
    EMAIL: SendEmail;
    /** Sender address on the onboarded domain, e.g. noreply@akt16.org. */
    EMAIL_FROM: string;
  }
}
