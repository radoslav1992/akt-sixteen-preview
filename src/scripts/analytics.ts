// Google Analytics events (gtag is loaded in src/layouts/Base.astro). Parameters are fixed
// categories only: never an email address, a search text or a watched item's name.

type EventParams = { [key: string]: string | number | boolean };

export function track(event: "follow_click" | "alert_signup" | "business_lead", params: EventParams = {}): void {
  try {
    (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.("event", event, params);
  } catch {
    // Analytics must never break the page.
  }
}
