// "Проверка на имот": searches both registers and groups matches by cadastral parcel into a timeline.
import { readableCase } from "../lib/textcase";
import { normalizeQuery, parcelIdOf } from "../lib/search";
import { isWatched, onChange } from "./watchlist";
import { syncFollowButton, toggleFollow } from "./follow";

interface ClientRecord { n: string; d: string; o: string; r: string; m: string; s: string; k: string; t: string; c: string; h: string }
interface Doc extends ClientRecord { reg: "act16" | "permits" }
interface Group { id: string; docs: Doc[]; latest: number }

const PAGE = 20;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dateNum = (s: string) => { const [d, m, y] = s.split("."); return +y * 10000 + +m * 100 + +d; };
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const fmt = (n: number) => n.toLocaleString("bg-BG").replace(/ /g, " ");
const BELL = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 21h4"/></svg>';
// Building types from src/lib/classify.ts; the rest (networks, energy, other works) are called „строежът“.
const BUILDINGS = new Set(["multi", "single", "office", "retail", "industrial", "public"]);
const NEXT_HINT = "Има разрешение за строеж, но при нас няма Акт 16 за този имот. Получете имейл, когато в регистъра на НАГ се появи такъв — или друг нов документ за имота. Безплатно.";

export function initCheck(): void {
  const form = document.getElementById("check-form") as HTMLFormElement;
  const input = document.getElementById("check-q") as HTMLInputElement;
  const status = document.getElementById("check-status")!;
  const results = document.getElementById("check-results")!;
  const more = document.getElementById("check-more") as HTMLButtonElement;
  const follow = document.getElementById("check-follow") as HTMLButtonElement;
  let docs: Doc[] | null = null;
  let groups: Group[] = [];
  let shown = 0;
  let terms: string[] = [];
  let followKey = "";

  const followBox = document.getElementById("check-follow-box")!;
  const followHint = document.getElementById("check-follow-hint")!;
  const defaultHint = followHint.innerHTML;

  // A saved search: the daily email digest reports new documents that match it.
  function syncFollow() {
    followBox.hidden = !followKey;
    syncFollowButton(follow, followHint, defaultHint, !!followKey && isWatched("search", followKey));
    // Parcels with a permit and no certificate: „Кажете ми, когато сградата получи Акт 16“.
    results.querySelectorAll<HTMLButtonElement>("[data-parcel]").forEach((btn) => {
      syncFollowButton(btn, btn.parentElement!.querySelector<HTMLElement>(".follow__hint"), NEXT_HINT, isWatched("parcel", btn.dataset.parcel!));
    });
  }
  follow.addEventListener("click", async () => {
    if (!followKey) return;
    await toggleFollow({ kind: "search", key: followKey, label: `Търсене: „${followKey}“`, url: `/check/?q=${encodeURIComponent(followKey)}` });
    syncFollow();
  });
  results.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-parcel]");
    if (!btn) return;
    await toggleFollow({ kind: "parcel", key: btn.dataset.parcel!, label: btn.dataset.label!, url: `/check/?q=${encodeURIComponent(btn.dataset.parcel!)}` });
    syncFollow();
  });
  onChange(syncFollow);

  async function load(): Promise<Doc[]> {
    if (docs) return docs;
    status.textContent = "Зареждане на регистрите…";
    const [a, p] = await Promise.all(["act16", "permits"].map((id) => fetch(`/api/${id}.json`).then((r) => r.json() as Promise<ClientRecord[]>)));
    docs = [...a.map((r) => ({ ...r, reg: "act16" as const })), ...p.map((r) => ({ ...r, reg: "permits" as const }))];
    return docs;
  }

  const highlight = (text: string) => {
    let out = esc(text);
    for (const t of terms) {
      if (t.length < 3) continue;
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      out = out.replace(re, "<mark>$1</mark>");
    }
    return out;
  };

  function renderGroup(g: Group): string {
    const sorted = [...g.docs].sort((x, y) => dateNum(x.d) - dateNum(y.d));
    const permit = sorted.filter((d) => d.reg === "permits").pop();
    const cert = sorted.filter((d) => d.reg === "act16").pop();
    const place = [sorted[0].h, sorted[0].r].filter(Boolean).join(", ");
    const statusHtml = [
      permit ? `<span class="badge badge--permits">✓ Разрешение ${esc(permit.d.slice(-4))}</span>` : `<span class="badge">Няма разрешение (от 2021 г.)</span>`,
      cert ? `<span class="badge badge--act16">✓ Акт 16 ${esc(cert.d.slice(-4))}</span>` : `<span class="badge badge--warn">Няма Акт 16 в регистъра</span>`,
    ].join("");
    const title = g.id.startsWith("doc:") ? "Документ без идентификатор КККР" : `Имот ${g.id}`;
    // The alert for a parcel reports every new document on it, so it also brings the certificate.
    const awaitsAct16 = !!permit && !cert && !g.id.startsWith("doc:");
    const cta = `Кажете ми, когато ${BUILDINGS.has(permit?.t ?? "") ? "сградата" : "строежът"} получи Акт 16`;
    const next = awaitsAct16 ? `<div class="parcel__next follow">
        <button type="button" class="btn btn--dark btn--sm follow-btn" data-parcel="${esc(g.id)}" data-label="${esc(`Имот ${g.id}${place ? ` · ${place}` : ""}`)}" data-cta="${esc(cta)}" data-on="Следите имота" aria-pressed="false">${BELL}<span data-follow-text>${esc(cta)}</span></button>
        <p class="follow__hint">${NEXT_HINT}</p>
      </div>` : "";
    return `<article class="parcel">
      <header class="parcel__head">
        <div><div class="parcel__id">${esc(title)}</div><div class="parcel__place">${esc(place || "София")}</div></div>
        <div class="parcel__status">${statusHtml}</div>
      </header>${next}
      <ol class="parcel__docs">${sorted.map((d) => `<li><a href="/register/${d.reg}/${esc(d.k)}/">
        <span class="parcel__bar parcel__bar--${d.reg}"></span>
        <span class="parcel__meta"><b>${d.reg === "act16" ? "Акт 16" : "Разрешение"} № ${esc(d.n)}</b> · ${esc(d.d)}${d.m ? ` · ${esc(truncate(d.m, 50))}` : ""}</span>
        <span class="parcel__text">${highlight(truncate(readableCase(d.o), 200))}</span>
      </a></li>`).join("")}</ol>
    </article>`;
  }

  function renderMore() {
    const slice = groups.slice(shown, shown + PAGE);
    results.insertAdjacentHTML("beforeend", slice.map(renderGroup).join(""));
    shown += slice.length;
    more.hidden = shown >= groups.length;
    syncFollow();
  }

  async function search(q: string) {
    const query = normalizeQuery(q);
    results.innerHTML = "";
    more.hidden = true;
    followKey = query.length >= 2 ? query.slice(0, 200) : "";
    syncFollow();
    if (query.length < 2) {
      status.textContent = query ? "Въведете поне 2 символа." : "";
      return;
    }
    const all = await load();
    terms = query.split(" ").filter(Boolean);
    const idQuery = /^\d{5}(\.\d*)*$/.test(query);
    const matched = all.filter((d) => {
      if (idQuery) return d.c.split(" ").some((c) => c.startsWith(query)) || d.n === query;
      const hay = normalizeQuery(`${d.n} ${d.o} ${d.r} ${d.m} ${d.s} ${d.c} ${d.h}`);
      return terms.every((t) => hay.includes(t));
    });

    // Pull in every document on the matched parcels so the history is complete. Documents filed under a
    // building or unit id (68134.1932.720.1.21) belong to their parcel (68134.1932.720).
    const byParcel = new Map<string, Doc[]>();
    for (const d of all) for (const c of new Set(d.c.split(" ").filter(Boolean).map(parcelIdOf))) byParcel.set(c, [...(byParcel.get(c) ?? []), d]);
    const map = new Map<string, Group>();
    for (const d of matched) {
      const first = d.c.split(" ").find(Boolean);
      const id = first ? parcelIdOf(first) : `doc:${d.reg}:${d.k}`;
      if (!map.has(id)) {
        const related = id.startsWith("doc:") ? [d] : byParcel.get(id) ?? [d];
        map.set(id, { id, docs: [...new Set(related)], latest: 0 });
      }
    }
    groups = [...map.values()];
    for (const g of groups) g.latest = Math.max(...g.docs.map((d) => dateNum(d.d)));
    groups.sort((a, b) => b.latest - a.latest);
    shown = 0;
    status.textContent = groups.length
      ? `${fmt(groups.length)} ${groups.length === 1 ? "имот" : "имота"} · ${fmt(matched.length)} документа`
      : "Няма резултати. Опитайте с по-кратък текст, само името на улицата или кадастралния идентификатор.";
    renderMore();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    history.replaceState(null, "", q ? `/check/?q=${encodeURIComponent(q)}` : "/check/");
    search(q).catch(() => { status.textContent = "Не успяхме да заредим регистрите. Опитайте отново."; });
  });
  more.addEventListener("click", renderMore);

  const initial = new URLSearchParams(location.search).get("q");
  if (initial) {
    input.value = initial;
    search(initial).catch(() => { status.textContent = "Не успяхме да заредим регистрите."; });
  }
}
