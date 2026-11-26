// Worker entry: Astro handles requests; the daily cron trigger sends email digests (src/lib/alerts.ts)
// and deletes business-interest leads older than 12 months (src/lib/leads.ts).
import { handle } from "@astrojs/cloudflare/handler";
import { trailingSlashRedirect } from "./lib/seo";

export default {
  fetch(request, env, ctx) {
    return trailingSlashRedirect(request) ?? handle(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { runAlerts } = await import("./lib/alerts");
    ctx.waitUntil(
      runAlerts(env).then(
        (result) => console.log("[alerts]", JSON.stringify(result)),
        (err) => console.error("[alerts] failed", err instanceof Error ? err.stack : err),
      ),
    );
    // Separate from the digests: a missing table (migration 0003 not applied yet) must not stop them.
    if (env.DB) {
      const { purgeOldLeads } = await import("./lib/leads");
      ctx.waitUntil(
        purgeOldLeads(env.DB).then(
          (deleted) => deleted && console.log("[leads] deleted after 12 months:", deleted),
          (err) => console.error("[leads] cleanup failed", err instanceof Error ? err.message : err),
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
