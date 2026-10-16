// Акт 16 Тракер — content script on listing sites.
// Reads a few strings from the page, lets extract.js decide whether it is a Sofia listing, asks the
// background worker for a lookup and shows a small panel in a Shadow DOM. Never blocks the page and
// stays silent on errors.
(() => {
  "use strict";
  if (window.top !== window || window.__akt16Loaded) return;
  window.__akt16Loaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const X = globalThis.Akt16Extract;
  if (!api || !api.runtime || !X) return;

  const SITE = "https://akt16.org";
  const HOST = location.hostname.replace(/^www\./, "");
  const COLLAPSED_KEY = `collapsed:${HOST}`;

  // Best-effort selectors per site (markup changes often); the generic ones and the page text follow.
  const HINTS = {
    "imot.bg": [".advHeader .location", ".obiava .location", ".location"],
    "homes.bg": [".offer-location", ".location", "[class*='address']"],
    "imoti.net": [".location", ".address"],
    "alo.bg": [".ad-location", "[class*='location']"],
    "olx.bg": ["[data-testid='location-date']", "[data-testid='map-aside-section']"],
    "address.bg": [".property-location", ".address"],
    "bazar.bg": [".adLocation", ".location"],
    "yavlena.com": [".property-location", ".location"],
    "luximmo.bg": [".property-address", ".location"],
  };
  const LOCATION = ["[itemprop='address']", "[class*='location' i]", "[class*='address' i]", "[data-testid*='location' i]"];
  const BREADCRUMBS = ["[class*='breadcrumb' i]", "nav[aria-label*='breadcrumb' i]", "[itemtype*='BreadcrumbList']"];

  // ---------- Reading the page ----------

  const squash = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

  function firstText(selectors, max) {
    for (const selector of selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          const text = squash(el.innerText || el.textContent, max);
          if (text) return text;
        }
      } catch (e) {
        /* invalid selector in an older browser */
      }
    }
    return "";
  }

  function structuredAddresses() {
    const out = [];
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6 || out.length > 3) return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      if (typeof node.streetAddress === "string" || typeof node.addressLocality === "string") {
        out.push([node.streetAddress, node.addressLocality, node.addressRegion].filter((v) => typeof v === "string").join(", "));
      }
      for (const value of Object.values(node)) walk(value, depth + 1);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(script.textContent || ""), 0);
      } catch (e) {
        /* ignore broken JSON-LD */
      }
    }
    return out.join("\n");
  }

  function snapshot() {
    const hint = Object.entries(HINTS).find(([host]) => HOST === host || HOST.endsWith(`.${host}`));
    const main = document.querySelector("main, article, [role='main']");
    let text = main ? main.innerText || "" : "";
    if (text.length < 400 && document.body) text = document.body.innerText || "";
    const meta = document.querySelector('meta[property="og:description"], meta[name="description"]');
    return {
      title: document.title,
      h1: squash(document.querySelector("h1")?.innerText, 300),
      location: firstText([...(hint ? hint[1] : []), ...LOCATION], 300),
      breadcrumbs: firstText(BREADCRUMBS, 400),
      address: structuredAddresses(),
      description: squash(meta?.getAttribute("content"), 500),
      text: text.slice(0, 40000),
    };
  }

  // ---------- Extension APIs (promise style works in Chrome MV3 and Firefox) ----------

  const send = (message) => Promise.resolve(api.runtime.sendMessage(message)).catch(() => null);

  async function storageGet(keys) {
    try {
      return (await api.storage.local.get(keys)) || {};
    } catch (e) {
      return {};
    }
  }

  function storageSet(values) {
    try {
      Promise.resolve(api.storage.local.set(values)).catch(() => {});
    } catch (e) {
      /* storage unavailable */
    }
  }

  // ---------- Rendering ----------

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .panel, .tab { font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: 340px; max-width: calc(100vw - 32px); max-height: min(72vh, 620px);
      display: flex; flex-direction: column; overflow: hidden;
      background: #121418; color: #f2f0ea; border-radius: 14px;
      box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.07);
    }
    .stripe { flex: none; height: 6px; background: repeating-linear-gradient(-45deg, #ffc21a 0 10px, #121418 10px 20px); }
    .head { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #2b3038; }
    .mark {
      width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 7px;
      background: #ffc21a; color: #121418; font-weight: 900; font-size: 15px; letter-spacing: -0.03em;
      box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.15);
    }
    .brand { flex: 1; min-width: 0; }
    .brand b { display: block; color: #fff; font-size: 14px; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; }
    .brand span { display: block; color: #a3aab5; font-size: 11px; }
    button { font: inherit; }
    .icon-btn {
      width: 32px; height: 32px; flex: none; display: grid; place-items: center; cursor: pointer;
      border-radius: 8px; border: 1px solid #3a404b; background: transparent; color: #f2f0ea; font-size: 18px; line-height: 1;
    }
    .icon-btn:hover { border-color: #ffc21a; color: #ffc21a; }
    :focus-visible { outline: 3px solid #ffc21a; outline-offset: 2px; }
    .body { overflow-y: auto; padding: 12px; display: grid; gap: 14px; overscroll-behavior: contain; }
    h2 { margin: 0 0 6px; color: #ffc21a; font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
    p { margin: 0; }
    a { color: inherit; }
    .muted { color: #a3aab5; font-size: 12px; }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .chip { display: inline-flex; padding: 2px 9px; border-radius: 999px; background: #2b3038; color: #fff; font-size: 12px; font-weight: 700; }
    .chip--act16, .chip--use-permit { background: #0b8770; }
    .chip--construction { background: #e8590c; color: #121418; }
    .hood { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .hood a, .hood strong { color: #fff; font-size: 15px; font-weight: 800; text-decoration: none; }
    .hood a:hover { text-decoration: underline; text-decoration-color: #ffc21a; text-underline-offset: 3px; }
    .stats { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 4px 0 8px; }
    .stat { display: inline-flex; align-items: center; gap: 6px; color: #d8d6d0; }
    .stat b { color: #fff; font-size: 15px; font-variant-numeric: tabular-nums; }
    .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .dot--act16 { background: #0b8770; }
    .dot--permits { background: #e8590c; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .doc {
      display: grid; grid-template-columns: 4px 1fr; gap: 2px 9px; padding: 7px 9px; border-radius: 9px;
      background: #1b1e24; border: 1px solid transparent; text-decoration: none;
    }
    .doc:hover { border-color: #3a404b; }
    .bar { grid-row: span 2; border-radius: 2px; background: #0b8770; }
    .bar--permits { background: #e8590c; }
    .doc__title { color: #f2f0ea; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .doc__meta { color: #a3aab5; font-size: 11.5px; }
    .parcel { display: grid; gap: 5px; padding: 8px 9px; border-radius: 9px; background: #1b1e24; }
    .parcel__top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 8px; align-items: baseline; }
    .parcel__id { color: #fff; font: 700 12.5px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-decoration: none; white-space: nowrap; }
    a.parcel__id:hover { text-decoration: underline; text-decoration-color: #ffc21a; }
    .parcel__place { margin-left: auto; color: #a3aab5; font-size: 11.5px; text-align: right; }
    .parcel__text { color: #d8d6d0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; }
    .badge { padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; }
    .badge--act16 { background: #0b8770; color: #fff; }
    .badge--permits { background: #e8590c; color: #121418; }
    .badge--none { border: 1px dashed #6b7380; color: #d8d6d0; }
    .more { color: #ffc21a; font-size: 12px; font-weight: 700; text-decoration: none; }
    .more:hover { text-decoration: underline; }
    .cta {
      display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; border-radius: 10px;
      background: #ffc21a; color: #121418; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; text-decoration: none;
      box-shadow: 0 3px 0 #f2ad00;
    }
    .cta:hover { background: #ffcd3f; }
    .note { padding-left: 9px; border-left: 3px solid #ffc21a; color: #a3aab5; font-size: 11.5px; }
    .tab {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 48px; height: 48px; cursor: pointer;
      display: grid; place-items: center; border-radius: 12px; border: 2px solid #121418; background: #ffc21a; color: #121418;
      font-size: 19px; font-weight: 900; letter-spacing: -0.03em; box-shadow: 0 8px 20px -6px rgba(0, 0, 0, 0.5), inset 0 -4px 0 rgba(0, 0, 0, 0.14);
    }
    .tab:hover { transform: translateY(-1px); }
    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: rise 180ms ease-out; }
      @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    }
  `;

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false || child === "") continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const safeUrl = (url) => (typeof url === "string" && url.startsWith(`${SITE}/`) ? url : `${SITE}/check/`);
  const ext = (url, props, ...children) => h("a", { href: safeUrl(url), target: "_blank", rel: "noopener noreferrer", ...props }, ...children);
  const fmt = (n) => Number(n || 0).toLocaleString("bg-BG");
  const year = (date) => String(date || "").slice(-4);

  function claimsSection(claims) {
    if (!claims.length) return null;
    return h(
      "section",
      { "aria-label": "Какво твърди обявата" },
      h(
        "div",
        { class: "chips" },
        h("span", { class: "muted" }, "Обявата споменава:"),
        claims.map((c) => h("span", { class: `chip chip--${c.id}` }, c.planned ? `${c.label} (очакван)` : c.label)),
      ),
    );
  }

  function neighborhoodSection(hood) {
    if (!hood) return null;
    const docs = (hood.newBuildings || []).slice(0, 3);
    return h(
      "section",
      { "aria-label": "Квартал" },
      h("h2", null, hood.name && hood.name.startsWith("район") ? "Район" : "Квартал"),
      h("div", { class: "hood" }, hood.url ? ext(hood.url, null, hood.name) : h("strong", null, hood.name), hood.region && !/^район/.test(hood.name) ? h("span", { class: "muted" }, `р-н ${hood.region}`) : null),
      h(
        "div",
        { class: "stats" },
        h("span", { class: "stat" }, h("i", { class: "dot dot--act16", "aria-hidden": "true" }), h("b", null, fmt(hood.act16)), "с Акт 16"),
        h("span", { class: "stat" }, h("i", { class: "dot dot--permits", "aria-hidden": "true" }), h("b", null, fmt(hood.permits)), "разрешения"),
      ),
      docs.length
        ? [
            h("p", { class: "muted" }, "Нови жилищни сгради с Акт 16 (последните 2 г.):"),
            h(
              "ul",
              { style: "margin-top:6px" },
              docs.map((d) =>
                h("li", null, ext(d.url, { class: "doc" }, h("span", { class: "bar", "aria-hidden": "true" }), h("span", { class: "doc__title" }, d.title), h("span", { class: "doc__meta" }, `Акт 16 № ${d.number} · ${d.date}`))),
              ),
            ),
          ]
        : h("p", { class: "muted" }, "Няма нови жилищни сгради с Акт 16 в квартала за последните 2 години."),
    );
  }

  function parcelItem(p) {
    const main = p.act16 || p.permit || p.docs[p.docs.length - 1];
    // Describe the parcel by the document behind its status, not by the latest small alteration.
    const last = (main && p.docs.find((d) => d.url === main.url)) || p.docs[p.docs.length - 1];
    const badges = [
      p.permit ? h("span", { class: "badge badge--permits" }, `✓ Разрешение ${year(p.permit.date)}`) : null,
      p.act16 ? h("span", { class: "badge badge--act16" }, `✓ Акт 16 ${year(p.act16.date)}`) : h("span", { class: "badge badge--none" }, "Няма Акт 16 в регистъра"),
    ];
    return h(
      "li",
      { class: "parcel" },
      h("div", { class: "parcel__top" }, ext(main && main.url, { class: "parcel__id" }, p.id ? `Имот ${p.id}` : "Документ без КККР"), h("span", { class: "parcel__place" }, p.neighborhood || p.region || "София")),
      h("div", { class: "badges" }, badges),
      last ? h("p", { class: "parcel__text", title: last.title }, last.title) : null,
    );
  }

  function parcelsSection(data, ex) {
    if (!data || !data.parcels || !data.parcels.length || data.matchedBy === "hood") {
      if (data && data.query && data.query.street && data.matchedBy !== "cad") {
        return h("p", { class: "muted" }, `Не открихме документи за „${data.query.street}“${data.neighborhood ? " в този квартал" : ""}.`);
      }
      return null;
    }
    const title =
      data.matchedBy === "cad" ? "Имот по идентификатор КККР"
      : data.matchedBy === "street" ? `Съвпадения по улица „${data.query.street}“`
      : "Съвпадения";
    const shown = data.parcels.slice(0, 3);
    const rest = data.parcels.length - shown.length;
    return h(
      "section",
      { "aria-label": title },
      h("h2", null, title),
      h("ul", null, shown.map(parcelItem)),
      rest > 0 ? h("p", { style: "margin-top:6px" }, ext(data.checkUrl, { class: "more" }, `+ още ${rest} в akt16.org`)) : null,
    );
  }

  let host = null;

  function remove() {
    if (host) host.remove();
    host = null;
  }

  function render(ex, data, collapsed) {
    remove();
    host = document.createElement("div");
    host.id = "akt16-extension-root";
    host.setAttribute("data-akt16", "panel");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483000; right: 0; bottom: 0; width: 0; height: 0;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(h("style", null, STYLE));

    const searched = [ex.neighborhood, ex.streets[0], ex.cadastralIds[0]].filter(Boolean).join(" · ");
    const note =
      data && data.matchedBy === "cad"
        ? "Съвпадение по идентификатор КККР от обявата — сверете адреса."
        : "Съвпадение по квартал/улица — сверете адреса и идентификатора.";
    const notFound = data && !data.neighborhood && !(data.parcels && data.parcels.length) && ex.neighborhood ? `Не открихме „${ex.neighborhood}“ в регистрите на Столична община.` : null;

    const panel = h(
      "div",
      { class: "panel", role: "region", "aria-label": "Акт 16 Тракер — проверка на обявата", id: "akt16-panel" },
      h("div", { class: "stripe", "aria-hidden": "true" }),
      h(
        "div",
        { class: "head" },
        h("span", { class: "mark", "aria-hidden": "true" }, "16"),
        h("div", { class: "brand" }, h("b", null, "Акт 16 Тракер"), h("span", null, "Разрешения и Акт 16 по данни на НАГ")),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Свий панела", "aria-expanded": "true", "aria-controls": "akt16-panel", title: "Свий", onclick: () => setCollapsed(true) }, "–"),
      ),
      h(
        "div",
        { class: "body" },
        claimsSection(ex.claims),
        searched ? h("p", { class: "muted" }, `От обявата: ${searched}`) : null,
        notFound ? h("p", { class: "muted" }, notFound) : null,
        neighborhoodSection(data && data.neighborhood),
        parcelsSection(data, ex),
        ext(data ? data.checkUrl : `${SITE}/check/`, { class: "cta" }, "Провери в akt16.org →"),
        h("p", { class: "note" }, note),
      ),
    );
    const tab = h("button", { type: "button", class: "tab", "aria-label": "Покажи панела Акт 16 Тракер", "aria-expanded": "false", title: "Акт 16 Тракер", onclick: () => setCollapsed(false) }, "16");

    function setCollapsed(value, focus = true) {
      panel.hidden = value;
      tab.hidden = !value;
      storageSet({ [COLLAPSED_KEY]: value });
      if (focus) (value ? tab : panel.querySelector(".icon-btn")).focus();
    }
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setCollapsed(true);
    });

    shadow.append(panel, tab);
    panel.hidden = collapsed;
    tab.hidden = !collapsed;
    document.documentElement.append(host);
  }

  // ---------- Flow ----------

  let handledUrl = "";
  let busy = false;

  async function run() {
    const url = location.href;
    if (busy || url === handledUrl) return true;
    const page = snapshot();
    if (!X.isListingPage(page, url)) return false;
    busy = true;
    handledUrl = url;
    try {
      const settings = await storageGet(["enabled", COLLAPSED_KEY]);
      if (settings.enabled === false) return true;
      const ex = X.extract(page, url);
      const params = X.toLookupParams(ex);
      let data = null;
      if (Object.keys(params).length) {
        const res = await send({ type: "lookup", params });
        if (!res || !res.ok) return true; // offline or API error: stay silent
        data = res.data;
      }
      const useful = (data && (data.neighborhood || (data.parcels && data.parcels.length))) || ex.claims.length;
      if (useful && location.href === url) render(ex, data, settings[COLLAPSED_KEY] === true);
      return true;
    } catch (e) {
      return true;
    } finally {
      busy = false;
    }
  }

  // Listing sites that render on the client need a moment; retry a couple of times.
  async function start() {
    for (const delay of [0, 1500, 4000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (await run()) return;
    }
  }

  start();
  // Single-page apps change the URL without reloading.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    remove();
    start();
  }, 2000);
})();
