// Page chrome behaviour: theme, mobile menu, service worker, account badge, follow buttons.
import { getCachedUser, getItems, isWatched, onChange, type WatchKind } from "./watchlist";
import { showToast, syncFollowButton, toggleFollow } from "./follow";

export { showToast };

function initTheme(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = (theme: string) => {
    document.documentElement.setAttribute("data-theme", theme);
    meta?.setAttribute("content", "#121418");
  };
  document.querySelector(".theme-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch {}
    apply(next);
    document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });
}

function initMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
  if (!toggle) return;
  const set = (open: boolean) => {
    document.body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true"));
  document.getElementById("primary-nav")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) set(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
}

function renderAccount(): void {
  const user = getCachedUser();
  const label = document.querySelector("[data-account-label]");
  if (label) label.textContent = user ? (user.name || "Профил") : "Вход";
  const count = document.querySelector<HTMLElement>("[data-watch-count]");
  const n = getItems().length;
  if (count) {
    count.hidden = n === 0;
    count.textContent = String(n);
  }
  const link = document.querySelector("[data-account-link]");
  link?.setAttribute("aria-label", user ? `Профил${n ? `, ${n} следени` : ""}` : `Вход${n ? `, ${n} следени` : ""}`);
}

function initFollowButtons(): void {
  const boxes = [...document.querySelectorAll<HTMLElement>("[data-follow-box]")].map((box) => {
    const hint = box.querySelector<HTMLElement>("[data-follow-hint]");
    return { box, btn: box.querySelector<HTMLButtonElement>("[data-follow]")!, hint, defaultHint: hint?.innerHTML ?? "" };
  });
  const sync = () => boxes.forEach(({ btn, hint, defaultHint }) => {
    syncFollowButton(btn, hint, defaultHint, isWatched(btn.dataset.kind as WatchKind, btn.dataset.key!));
  });
  boxes.forEach(({ box, btn }) => {
    box.hidden = false;
    btn.addEventListener("click", async () => {
      await toggleFollow(
        { kind: btn.dataset.kind as WatchKind, key: btn.dataset.key!, label: btn.dataset.label!, url: btn.dataset.url! },
        btn.dataset.alerts !== "0",
      );
      sync();
    });
  });
  sync();
  // Following from another button on the page, or an expired session noticed by the API, changes the state.
  onChange(sync);
}

function initCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy === "url" ? location.href.split("?")[0] : btn.dataset.copy!;
      try {
        if (navigator.share && btn.dataset.share) await navigator.share({ title: document.title, url: text });
        else {
          await navigator.clipboard.writeText(text);
          showToast("Копирано.");
        }
      } catch {}
    });
  });
}

export function initShell(): void {
  initTheme();
  initMenu();
  renderAccount();
  onChange(renderAccount);
  initFollowButtons();
  initCopyButtons();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
