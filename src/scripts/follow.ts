// „Извести ме по имейл“ buttons: adds or removes a watched item and tells the visitor what happens next.
// The daily digest only goes to verified accounts with alerts switched on (src/lib/alerts.ts), so the
// text under the button depends on the visitor: guest, unverified, alerts off, or all set.
import { addItem, clearFollowIntent, getCachedUser, getFollowIntent, isWatched, removeItem, setFollowIntent, type WatchItem } from "./watchlist";
import { track } from "./analytics";

export const REGISTER_URL = "/account/?mode=register";

export type FollowState = "guest" | "muted" | "unverified" | "on";

export function followState(): FollowState {
  const user = getCachedUser();
  if (!user) return "guest";
  if (!user.email_alerts) return "muted";
  if (user.email_verified === false) return "unverified";
  return "on";
}

const link = (href: string, text: string) => `<a href="${href}">${text}</a>`;

/** Line under a followed item. `alerts` is false for items the digest cannot match. */
export function followedHint(alerts: boolean, state = followState()): string {
  if (!alerts) {
    return state === "guest"
      ? `Запазено в „Следени“ на това устройство. ${link("/account/", "Виж списъка")}`
      : `Запазено в „Следени“. ${link("/account/", "Виж списъка")}`;
  }
  switch (state) {
    case "guest":
      return `Запазено само на това устройство — без профил не изпращаме писма. ${link(REGISTER_URL, "Създайте безплатен профил")}, за да получавате имейл.`;
    case "muted":
      return `Следите, но имейл известията ви са изключени. ${link("/account/", "Включете ги от профила")}.`;
    case "unverified":
      return `Следите. Известията започват, след като потвърдите имейла си от писмото, което ви изпратихме. ${link("/account/", "Към профила")}`;
    default:
      return `Ще получите имейл, когато се появи нов документ — най-много едно писмо на ден. ${link("/account/", "Всички следени")}`;
  }
}

export function showToast(message: string, href?: string, action?: string): void {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  if (href && action) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = action;
    el.append(" ", a);
  }
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

function followedToast(alerts: boolean): void {
  if (!alerts) return showToast("Запазено в „Следени“.", "/account/", "Виж");
  switch (followState()) {
    case "guest":
      return showToast("Запазено на това устройство. За имейл известия създайте безплатен профил.", REGISTER_URL, "Създай профил");
    case "muted":
      return showToast("Следите. Имейл известията ви са изключени.", "/account/", "Включи");
    case "unverified":
      return showToast("Следите. Потвърдете имейла си, за да започнат известията.", "/account/", "Профил");
    default:
      return showToast("Ще ви известим по имейл при нов документ.", "/account/", "Виж");
  }
}

/** Follows or unfollows the item; returns whether it is followed afterwards. */
export async function toggleFollow(item: WatchItem, alerts = true): Promise<boolean> {
  if (isWatched(item.kind, item.key)) {
    await removeItem(item.kind, item.key);
    const intent = getFollowIntent();
    if (intent && intent.kind === item.kind && intent.key === item.key) clearFollowIntent();
    return false;
  }
  track("follow_click", { kind: item.kind, signed_in: !!getCachedUser() });
  await addItem(item);
  // A guest's choice is remembered so that the account page can finish the job (see account.ts).
  if (alerts && !getCachedUser()) setFollowIntent(item);
  followedToast(alerts);
  return true;
}

/** Keeps one button and the line under it in step with the watchlist. */
export function syncFollowButton(btn: HTMLButtonElement, hint: HTMLElement | null, defaultHint: string, on: boolean): void {
  const alerts = btn.dataset.alerts !== "0";
  btn.setAttribute("aria-pressed", String(on));
  const text = btn.querySelector("[data-follow-text]");
  if (text) text.textContent = on ? btn.dataset.on ?? (alerts ? "Следите" : "Запазено") : btn.dataset.cta ?? "Извести ме по имейл";
  if (hint) hint.innerHTML = on ? followedHint(alerts) : defaultHint;
}
