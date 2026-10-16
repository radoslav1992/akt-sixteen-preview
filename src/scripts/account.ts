// Account page: sign-in / registration, profile settings and the watchlist with "new since last visit" counts.
import { matchesQuery, parcelIdOf, queryTerms } from "../lib/search";
import { auth, getCachedUser, getItems, markSeen, onChange, refreshSession, removeItem, setCachedUser, syncAfterLogin, type WatchItem } from "./watchlist";

interface ClientRecord { n: string; d: string; r: string; m: string; c: string; h: string; k: string; o?: string; s?: string }

const KIND_LABELS: { [k: string]: string } = {
  parcel: "Имоти", record: "Документи", company: "Фирми", region: "Райони", neighborhood: "Квартали и села", search: "Запазени търсения",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dateNum = (s: string) => { const [d, m, y] = s.split("."); return +y * 10000 + +m * 100 + +d; };
const isoNum = (iso: string) => +iso.slice(0, 10).replace(/-/g, "");

interface TaggedRecord extends ClientRecord { reg: "act16" | "permits"; k: string; o?: string; s?: string }
let records: TaggedRecord[] | null = null;
let firstSeen: Map<string, string> | null = null;

async function loadRecords(): Promise<TaggedRecord[]> {
  if (records) return records;
  const [act16, permits, changes] = await Promise.all([
    fetch("/api/act16.json").then((r) => r.json()),
    fetch("/api/permits.json").then((r) => r.json()),
    fetch("/api/changes.json").then((r) => r.json()).catch(() => ({ entries: [] })),
  ]);
  firstSeen = new Map();
  for (const entry of changes.entries ?? []) {
    for (const reg of ["act16", "permits"]) for (const slug of entry[reg] ?? []) if (!firstSeen.has(`${reg}:${slug}`)) firstSeen.set(`${reg}:${slug}`, entry.at);
  }
  return (records = [
    ...act16.map((r: ClientRecord) => ({ ...r, reg: "act16" as const })),
    ...permits.map((r: ClientRecord) => ({ ...r, reg: "permits" as const })),
  ]);
}

/** New since `since` (ISO): it first appeared in the registers after that time, or (before the change log existed) was issued after it. */
function isNewSince(r: TaggedRecord, since: string): boolean {
  const seen = firstSeen?.get(`${r.reg}:${r.k}`);
  return seen ? seen > since : dateNum(r.d) > isoNum(since);
}

function matcher(item: WatchItem): ((r: ClientRecord) => boolean) | null {
  switch (item.kind) {
    case "parcel": { const parcel = parcelIdOf(item.key); return (r) => r.c.split(" ").some((id) => id && parcelIdOf(id) === parcel); }
    case "region": { const name = item.label.replace(/^Район\s+/, ""); return (r) => r.r === name; }
    case "neighborhood": { const name = item.label.replace(/^(с\.|гр\.)\s+/, ""); return (r) => r.h === name; }
    case "search": {
      const terms = queryTerms(item.key);
      return (r) => matchesQuery(terms, `${r.n} ${r.o ?? ""} ${r.r} ${r.m} ${r.s ?? ""} ${r.c} ${r.h}`);
    }
    case "company": { const name = item.label.replace(/^ЕТ\s+/, "").replace(/[„“"]/g, "").replace(/\s+(ЕООД|ООД|ЕАД|АД|ДЗЗД|КДА|КД|СД|АДСИЦ)$/, "").trim().toLocaleUpperCase("bg-BG"); return (r) => r.m.toLocaleUpperCase("bg-BG").includes(name); }
    default: return null;
  }
}

async function newCounts(items: WatchItem[]): Promise<Map<WatchItem, number>> {
  const out = new Map<WatchItem, number>();
  const relevant = items.filter((i) => matcher(i));
  if (!relevant.length) return out;
  const all = await loadRecords();
  for (const item of relevant) {
    const since = item.last_seen_at || item.created_at || new Date().toISOString();
    const match = matcher(item)!;
    out.set(item, all.filter((r) => isNewSince(r, since) && match(r)).length);
  }
  return out;
}

export function initAccount(): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const list = $("watch-list");
  const empty = $("watch-empty");
  const markAll = $<HTMLButtonElement>("mark-all");
  const authBox = $("auth-forms");
  const profile = $("profile");
  const form = $<HTMLFormElement>("auth-form");
  const errorEl = $("auth-error");
  const submit = $<HTMLButtonElement>("auth-submit");
  let mode: "login" | "register" = new URLSearchParams(location.search).get("mode") === "register" ? "register" : "login";

  function setMode(next: "login" | "register") {
    mode = next;
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === mode)));
    document.querySelectorAll<HTMLElement>("[data-only='register']").forEach((el) => (el.hidden = mode !== "register"));
    document.querySelectorAll<HTMLElement>("[data-only='login']").forEach((el) => (el.hidden = mode !== "login"));
    submit.textContent = mode === "register" ? "Създай профил" : "Вход";
    $<HTMLInputElement>("auth-password").autocomplete = mode === "register" ? "new-password" : "current-password";
    errorEl.hidden = true;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.tab as "login" | "register")));
  setMode(mode);

  async function renderList() {
    const items = getItems();
    empty.hidden = items.length > 0;
    markAll.hidden = items.length === 0;
    if (!items.length) { list.innerHTML = ""; return; }
    const groups = new Map<string, WatchItem[]>();
    for (const item of items) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
    const draw = (counts: Map<WatchItem, number>) => {
      list.innerHTML = [...groups.entries()].map(([kind, group]) => `
        <div class="watch-group"><h3>${esc(KIND_LABELS[kind] ?? kind)}</h3>
          ${group.map((item, i) => {
            const n = counts.get(item) ?? 0;
            return `<div class="watch-item">
              <a href="${esc(item.url)}" data-kind="${esc(item.kind)}" data-key="${esc(item.key)}">${esc(item.label)}</a>
              <span class="watch-item__meta">
                ${n ? `<span class="watch-item__new" title="Документи с дата след последното отбелязване">+${n} нови</span>` : ""}
                <button type="button" data-remove="${esc(kind)}|${i}" aria-label="Спри да следиш ${esc(item.label)}">✕</button>
              </span>
            </div>`;
          }).join("")}
        </div>`).join("");
      list.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => btn.addEventListener("click", async () => {
        const [kind, i] = btn.dataset.remove!.split("|");
        const item = groups.get(kind)![+i];
        await removeItem(item.kind, item.key);
        renderList();
      }));
      list.querySelectorAll<HTMLAnchorElement>("a[data-kind]").forEach((a) => a.addEventListener("click", () => {
        markSeen(a.dataset.kind as WatchItem["kind"], a.dataset.key!);
      }));
    };
    draw(new Map());
    try { draw(await newCounts(items)); } catch {}
  }

  function renderUser() {
    const user = getCachedUser();
    authBox.hidden = !!user;
    profile.hidden = !user;
    document.querySelector("[data-state-title]")!.textContent = user ? `Здравейте${user.name ? ", " + user.name : ""}` : "Следени обекти";
    document.querySelector("[data-state-lead]")!.textContent = user
      ? "Списъкът ви се пази в профила и е достъпен от всяко устройство."
      : "Следете имоти, райони, квартали и фирми. Без профил списъкът се пази само на това устройство.";
    if (user) {
      $("profile-email").textContent = user.email;
      $<HTMLInputElement>("settings-name").value = user.name ?? "";
      $<HTMLInputElement>("settings-alerts").checked = !!user.email_alerts;
      $("verify-banner").hidden = user.email_verified !== false;
      $<HTMLButtonElement>("test-alert").disabled = user.email_verified === false;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const email = $<HTMLInputElement>("auth-email").value.trim();
    const password = $<HTMLInputElement>("auth-password").value;
    const name = $<HTMLInputElement>("auth-name").value.trim();
    if (!email || password.length < 8) {
      errorEl.textContent = "Въведете имейл и парола от поне 8 символа.";
      errorEl.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      const { user } = mode === "register"
        ? await auth.register(email, password, name || undefined, $<HTMLInputElement>("auth-alerts").checked)
        : await auth.login(email, password);
      setCachedUser(user);
      await syncAfterLogin();
      renderUser();
      renderList();
    } catch (err) {
      errorEl.textContent = (err as Error).message || "Възникна грешка. Опитайте отново.";
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { user } = await auth.settings({ name: $<HTMLInputElement>("settings-name").value.trim(), email_alerts: $<HTMLInputElement>("settings-alerts").checked });
      setCachedUser(user);
      renderUser();
      $("settings-status").textContent = "Запазено.";
    } catch (err) { $("settings-status").textContent = (err as Error).message; }
  });

  $("logout").addEventListener("click", async () => {
    await auth.logout().catch(() => {});
    setCachedUser(null);
    renderUser();
  });

  $("delete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm("Сигурни ли сте? Профилът и списъкът ще бъдат изтрити.")) return;
    try {
      await auth.deleteAccount($<HTMLInputElement>("delete-password").value);
      setCachedUser(null);
      try { localStorage.removeItem("akt16:watch"); } catch {}
      renderUser();
      renderList();
    } catch (err) { alert((err as Error).message); }
  });

  $("verify-resend").addEventListener("click", async () => {
    try {
      const res = await auth.resendVerification();
      $("verify-status").textContent = res.already ? "Имейлът вече е потвърден." : "Изпратихме ново писмо. Проверете и папката за нежелана поща.";
      if (res.already) refreshSession().then(renderUser);
    } catch (err) { $("verify-status").textContent = (err as Error).message; }
  });

  $("test-alert").addEventListener("click", async () => {
    try {
      const res = await auth.testAlert();
      $("test-status").textContent = `Изпратихме тестово писмо с ${res.documents} документа.`;
    } catch (err) { $("test-status").textContent = (err as Error).message; }
  });

  markAll.addEventListener("click", async () => {
    for (const item of getItems()) await markSeen(item.kind, item.key);
    renderList();
  });

  onChange(() => renderUser());
  renderUser();
  renderList();
  refreshSession().then(() => { renderUser(); renderList(); });
}
