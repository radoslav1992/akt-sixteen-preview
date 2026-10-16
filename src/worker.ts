// Worker entry: Astro handles requests; the daily cron trigger sends email digests (src/lib/alerts.ts).
import { handle } from "@astrojs/cloudflare/handler";

export default {
  fetch: handle,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { runAlerts } = await import("./lib/alerts");
    ctx.waitUntil(
      runAlerts(env).then(
        (result) => console.log("[alerts]", JSON.stringify(result)),
        (err) => console.error("[alerts] failed", err instanceof Error ? err.stack : err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
