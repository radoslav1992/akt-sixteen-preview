// Interactive register explorer: loads the register JSON once, then filters, sorts and paginates client-side.
import { readableCase } from "../lib/textcase";

interface ClientRecord { n: string; d: string; o: string; r: string; m: string; s: string; k: string; t: string; c: string; h: string }

const PAGE_SIZE = 30;
const TYPE_LABELS: { [k: string]: string } = {
  multi: "Жилищни блокове", single: "Къщи", office: "Офиси", retail: "Търговия", industrial: "Складове",
  public: "Обществени", energy: "Енергетика", infra: "Инфраструктура", other: "Други",
};

export function initRegister(): void {
  const meta = JSON.parse(document.getElementById("register-meta")!.textContent!);
  const registerId: string = meta.registerId;
  let allRecords: ClientRecord[] = [];
  let filtered: ClientRecord[] = [];
  let currentPage = 1;
  let sortField = "date";
  let sortDir: "asc" | "desc" = "desc";

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const searchInput = $<HTMLInputElement>("search-input");
  const regionSelect = $<HTMLSelectElement>("region-select");
  const typeSelect = $<HTMLSelectElement>("type-select");
  const dateFrom = $<HTMLInputElement>("date-from");
  const dateTo = $<HTMLInputElement>("date-to");
  const resultsCount = $("results-count");
  const tableBody = $("table-body");
  const mobileList = $("mobile-list");
  const paginationEl = $("pagination");
  const activeFiltersEl = $("active-filters");
  const headers = document.querySelectorAll<HTMLTableCellElement>("th.sortable");

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + "…" : s);
  const fmt = (n: number) => n.toLocaleString("bg-BG").replace(/ /g, " ");
  const dateNum = (s: string) => { const [d, m, y] = s.split("."); return +y * 10000 + +m * 100 + +d; };
  const isoNum = (s: string) => +s.replace(/-/g, "");

  function applyFilters(preservePage = false) {
    const terms = searchInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const region = regionSelect.value;
    const type = typeSelect.value;
    const from = dateFrom.value ? isoNum(dateFrom.value) : 0;
    const to = dateTo.value ? isoNum(dateTo.value) : Infinity;
    filtered = allRecords.filter((r) => {
      if (region && r.r !== region) return false;
      if (type && r.t !== type) return false;
      const dn = dateNum(r.d);
      if (dn < from || dn > to) return false;
      if (terms.length) {
        const hay = `${r.n} ${r.o} ${r.r} ${r.m} ${r.s} ${r.c} ${r.h}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    applySort(preservePage);
  }

  function applySort(preservePage = false) {
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (r: ClientRecord): string | number => {
      switch (sortField) {
        case "number": return parseInt(r.n) || 0;
        case "date": return dateNum(r.d);
        case "object": return r.o.toLowerCase();
        case "region": return r.r.toLowerCase();
        case "meta": return r.m.toLowerCase();
        default: return 0;
      }
    };
    filtered.sort((a, b) => {
      const va = key(a), vb = key(b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    if (!preservePage) currentPage = 1;
    render();
  }

  function render() {
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const page = filtered.slice(start, start + PAGE_SIZE);

    resultsCount.textContent = total === 0
      ? "Няма намерени записи"
      : totalPages > 1 ? `${fmt(total)} записа · стр. ${currentPage} от ${totalPages}` : `${fmt(total)} записа`;

    if (!page.length) {
      tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Няма намерени записи. Опитайте с по-кратък текст или без филтър по дата.</td></tr>`;
      mobileList.innerHTML = `<p class="empty-state">Няма намерени записи. Опитайте с по-кратък текст.</p>`;
    } else {
      tableBody.innerHTML = page.map((r) => {
        const href = `/register/${registerId}/${esc(r.k)}/`;
        return `<tr class="row-link" data-href="${href}">
          <td class="cell-number"><a href="${href}">№ ${esc(r.n)}</a></td>
          <td class="cell-date">${esc(r.d)}</td>
          <td class="cell-object">${esc(truncate(readableCase(r.o), 180))}</td>
          <td>${r.r ? `<button type="button" class="badge badge--district badge--filter" data-region="${esc(r.r)}">${esc(r.r)}</button>` : "—"}</td>
          <td class="cell-meta">${esc(r.m || "—")}</td>
          <td class="cell-scope">${esc(r.h ? `${r.h} · ` : "")}${esc(truncate(r.s, 90))}</td>
        </tr>`;
      }).join("");
      mobileList.innerHTML = page.map((r) => {
        const href = `/register/${registerId}/${esc(r.k)}/`;
        return `<a href="${href}" class="m-card">
          <span class="m-card__head"><span class="m-card__num">№ ${esc(r.n)}</span><span class="m-card__date">${esc(r.d)}</span></span>
          <span class="m-card__obj">${esc(truncate(readableCase(r.o), 140))}</span>
          <span class="m-card__foot">${r.r ? `<span class="badge badge--district">${esc(r.r)}</span>` : ""}${r.h ? `<span>${esc(r.h)}</span>` : ""}${r.t ? `<span>· ${esc(TYPE_LABELS[r.t] ?? "")}</span>` : ""}</span>
        </a>`;
      }).join("");
    }

    tableBody.querySelectorAll<HTMLElement>(".row-link").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".badge--filter, a")) return;
        if (window.getSelection()?.toString()) return;
        location.href = row.dataset.href!;
      });
    });
    tableBody.querySelectorAll<HTMLElement>(".badge--filter").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        regionSelect.value = el.dataset.region || "";
        onFilterChange();
      });
    });

    headers.forEach((th) => {
      const active = th.dataset.sort === sortField;
      th.classList.toggle("sorted", active);
      th.setAttribute("aria-sort", active ? (sortDir === "asc" ? "ascending" : "descending") : "none");
      th.querySelector(".sort-icon")!.textContent = active ? (sortDir === "asc" ? "▲" : "▼") : "";
    });

    renderPagination(totalPages);
    renderActiveFilters();
    syncUrl();
  }

  function renderPagination(totalPages: number) {
    if (totalPages <= 1) { paginationEl.innerHTML = ""; return; }
    const pages: Array<number | "…"> = [];
    if (totalPages <= 7) for (let i = 1; i <= totalPages; i++) pages.push(i);
    else {
      pages.push(1);
      if (currentPage > 3) pages.push("…");
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("…");
      pages.push(totalPages);
    }
    paginationEl.innerHTML = `
      <button class="pg-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""} aria-label="Предишна страница">←<span class="pg-btn__label"> Предишна</span></button>
      <div class="pg-numbers">${pages.map((p) => p === "…" ? `<span class="pg-ellipsis">…</span>` : `<button class="pg-num ${p === currentPage ? "pg-num--active" : ""}" data-page="${p}" aria-label="Страница ${p}" ${p === currentPage ? 'aria-current="page"' : ""}>${p}</button>`).join("")}</div>
      <button class="pg-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""} aria-label="Следваща страница"><span class="pg-btn__label">Следваща </span>→</button>`;
    paginationEl.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) =>
      btn.addEventListener("click", () => {
        currentPage = parseInt(btn.dataset.page!);
        render();
        document.getElementById("results-count")!.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  }

  function renderActiveFilters() {
    const chips: string[] = [];
    if (regionSelect.value) chips.push(`<button class="chip chip--active" data-clear="region">Район: ${esc(regionSelect.value)} ×</button>`);
    if (typeSelect.value) chips.push(`<button class="chip chip--active" data-clear="type">${esc(TYPE_LABELS[typeSelect.value] ?? typeSelect.value)} ×</button>`);
    if (searchInput.value) chips.push(`<button class="chip chip--active" data-clear="search">„${esc(searchInput.value)}“ ×</button>`);
    if (dateFrom.value) chips.push(`<button class="chip chip--active" data-clear="dateFrom">От ${esc(dateFrom.value)} ×</button>`);
    if (dateTo.value) chips.push(`<button class="chip chip--active" data-clear="dateTo">До ${esc(dateTo.value)} ×</button>`);
    activeFiltersEl.innerHTML = chips.join("");
    activeFiltersEl.querySelectorAll<HTMLButtonElement>("[data-clear]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const target = chip.dataset.clear;
        if (target === "region") regionSelect.value = "";
        if (target === "type") typeSelect.value = "";
        if (target === "search") searchInput.value = "";
        if (target === "dateFrom") dateFrom.value = "";
        if (target === "dateTo") dateTo.value = "";
        onFilterChange();
      })
    );
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (searchInput.value) params.set("q", searchInput.value);
    if (typeSelect.value) params.set("type", typeSelect.value);
    if (dateFrom.value) params.set("from", dateFrom.value);
    if (dateTo.value) params.set("to", dateTo.value);
    if (sortField !== "date" || sortDir !== "desc") params.set("sort", `${sortField}-${sortDir}`);
    if (currentPage > 1) params.set("page", String(currentPage));
    // The district filter lives in the hash so it never creates a separately crawlable URL.
    const hash = regionSelect.value ? `#region=${encodeURIComponent(regionSelect.value)}` : "";
    const qs = params.toString();
    history.replaceState(null, "", `/register/${registerId}/${qs ? "?" + qs : ""}${hash}`);
  }

  function restoreFromUrl() {
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    const region = hash.get("region") ?? params.get("region");
    if (region) regionSelect.value = region.replace(/\s+/g, " ").trim();
    if (params.has("q")) searchInput.value = params.get("q")!;
    const type = hash.get("type") ?? params.get("type");
    if (type) typeSelect.value = type;
    if (params.has("from")) dateFrom.value = params.get("from")!;
    if (params.has("to")) dateTo.value = params.get("to")!;
    if (params.has("sort")) {
      const [f, d] = params.get("sort")!.split("-");
      sortField = f;
      sortDir = d === "asc" ? "asc" : "desc";
    }
    if (params.has("page")) currentPage = parseInt(params.get("page")!) || 1;
  }

  let debounce: number;
  function onFilterChange() {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => applyFilters(), 120);
  }

  searchInput.addEventListener("input", onFilterChange);
  [regionSelect, typeSelect, dateFrom, dateTo].forEach((el) => el.addEventListener("change", onFilterChange));
  document.getElementById("clear-filters")!.addEventListener("click", () => {
    searchInput.value = regionSelect.value = typeSelect.value = dateFrom.value = dateTo.value = "";
    sortField = "date";
    sortDir = "desc";
    onFilterChange();
  });
  headers.forEach((th) => {
    th.querySelector("button")!.addEventListener("click", () => {
      const field = th.dataset.sort!;
      if (sortField === field) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortField = field; sortDir = field === "date" || field === "number" ? "desc" : "asc"; }
      applySort();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".preset-btn[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = parseInt(btn.dataset.preset!);
      const to = new Date();
      const from = new Date();
      from.setDate(to.getDate() - days);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dateFrom.value = iso(from);
      dateTo.value = iso(to);
      onFilterChange();
    });
  });
  document.getElementById("export-csv")?.addEventListener("click", () => {
    const cols: Array<[keyof ClientRecord, string]> = [["n", "Номер"], ["d", "Дата"], ["o", "Обект"], ["r", "Район"], ["h", "Квартал"], ["m", meta.metaLabel], ["c", "Идентификатор КККР"], ["s", "Местоположение"]];
    const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [cols.map(([, l]) => cell(l)).join(","), ...filtered.map((r) => cols.map(([k]) => cell(r[k])).join(","))];
    const url = URL.createObjectURL(new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `akt16-${registerId}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
      e.preventDefault();
      searchInput.focus();
    }
  });

  (async () => {
    try {
      const res = await fetch(`/api/${registerId}.json`);
      if (!res.ok) throw new Error("Register request failed");
      allRecords = await res.json();
    } catch {
      document.getElementById("load-error")!.hidden = false;
      return;
    }
    restoreFromUrl();
    applyFilters(true);
  })();
}
