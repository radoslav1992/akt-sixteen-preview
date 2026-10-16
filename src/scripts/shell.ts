// Page chrome behaviour: theme, mobile menu, service worker, account badge, follow buttons.
import { addItem, getCachedUser, getItems, isWatched, onChange, removeItem, type WatchKind } from "./watchlist";

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
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-follow]");
  const sync = () => buttons.forEach((btn) => {
    const on = isWatched(btn.dataset.kind as WatchKind, btn.dataset.key!);
    btn.setAttribute("aria-pressed", String(on));
    const text = btn.querySelector("[data-follow-text]");
    if (text) text.textContent = on ? "Следите" : "Следи";
  });
  buttons.forEach((btn) => {
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.kind as WatchKind;
      const key = btn.dataset.key!;
      if (isWatched(kind, key)) await removeItem(kind, key);
      else {
        await addItem({ kind, key, label: btn.dataset.label!, url: btn.dataset.url! });
        if (!getCachedUser()) showToast("Добавено в „Следени“ на това устройство. Влезте, за да ги пазите в профил.", "/account/", "Вход");
        else showToast("Добавено в „Следени“.", "/account/", "Виж");
      }
      sync();
    });
  });
  sync();
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
  setTimeout(() => el.remove(), 5000);
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
