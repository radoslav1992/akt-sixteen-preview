import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { InputError, USER_COLUMNS, handle, json, nowIso, parseName, toUser } from "../../../lib/auth";

export const prerender = false;

// Body: {name?, email_alerts?}; omitted fields keep their current value, name "" or null clears it.
export const POST: APIRoute = (ctx) =>
  handle(env.DB, ctx, { auth: true, body: true }, async ({ db, body, user }) => {
    const name = "name" in body ? parseName(body.name) : user.name;
    let alerts = user.email_alerts;
    if ("email_alerts" in body) {
      if (![true, false, 0, 1].includes(body.email_alerts as boolean)) {
        throw new InputError("Невалидна стойност за имейл известията.");
      }
      alerts = Boolean(body.email_alerts);
    }
    // Switching alerts on starts from now, so the first digest is not a backlog of old changes.
    const turnedOn = alerts && !user.email_alerts;
    const row = await db
      .prepare(`UPDATE users SET name = ?, email_alerts = ?, last_alert_at = CASE WHEN ? THEN ? ELSE last_alert_at END WHERE id = ? RETURNING ${USER_COLUMNS}`)
      .bind(name, alerts ? 1 : 0, turnedOn ? 1 : 0, nowIso(), user.id)
      .first<Record<string, unknown>>();
    return json({ user: row ? toUser(row) : null });
  });
