// Акт 16 Тракер — toolbar popup: search box with quick results and the panel on/off switch.
"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const SITE = "https://akt16.org";
const form = document.getElementById("form");
const input = document.getElementById("q");
const status = document.getElementById("status");
const results = document.getElementById("results");
const enabled = document.getElementById("enabled");

const checkUrl = (q) => `${SITE}/check/${q ? `?q=${encodeURIComponent(q)}` : ""}`;
const safeUrl = (url) => (typeof url === "string" && url.startsWith(`${SITE}/`) ? url : `${SITE}/check/`);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) if (value != null) el.setAttribute(key, String(value));
  for (const child of children.flat()) if (child != null && child !== "") el.append(child instanceof Node ? child : String(child));
  return el;
}

function open(url) {
  try {
    Promise.resolve(api.tabs.create({ url })).finally(() => window.close());
  } catch (e) {
    window.open(url, "_blank", "noopener");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  open(checkUrl(input.value.replace(/\s+/g, " ").trim().slice(0, 120)));
});

function renderParcel(p) {
  const target = p.act16 || p.permit || p.docs[p.docs.length - 1];
  const last = (target && p.docs.find((d) => d.url === target.url)) || p.docs[p.docs.length - 1];
  return h(
    "li",
    null,
    h(
      "a",
      { class: "item", href: safeUrl(target && target.url), target: "_blank", rel: "noopener" },
      h("span", { class: "item__top" }, h("span", { class: "item__id" }, p.id ? `Имот ${p.id}` : "Документ без КККР"), h("span", { class: "item__place" }, p.neighborhood || p.region || "София")),
      h(
        "span",
        { class: "badges" },
        p.permit ? h("span", { class: "badge badge--permits" }, `✓ Разрешение ${p.permit.date.slice(-4)}`) : null,
        p.act16 ? h("span", { class: "badge badge--act16" }, `✓ Акт 16 ${p.act16.date.slice(-4)}`) : h("span", { class: "badge badge--none" }, "Няма Акт 16 в регистъра"),
      ),
      last ? h("span", { class: "item__text", title: last.title }, last.title) : null,
    ),
  );
}

let seq = 0;
async function quickSearch(q) {
  const id = ++seq;
  results.replaceChildren();
  if (q.length < 3) {
    status.textContent = "";
    return;
  }
  status.textContent = "Търсене…";
  let res = null;
  try {
    res = await api.runtime.sendMessage({ type: "lookup", params: { q } });
  } catch (e) {
    res = null;
  }
  if (id !== seq) return;
  if (!res || !res.ok) {
    status.textContent = "Няма връзка с akt16.org. Натиснете „Провери“, за да отворите сайта.";
    return;
  }
  const data = res.data;
  const parcels = (data.parcels || []).slice(0, 5);
  status.textContent = parcels.length ? `${data.matched.toLocaleString("bg-BG")} документа · първите ${parcels.length} имота` : "Няма бързи резултати. Опитайте с улица или идентификатор.";
  const items = parcels.map(renderParcel);
  if (data.neighborhood) {
    const n = data.neighborhood;
    items.unshift(h("li", { class: "hood" }, h("b", null, n.name), ` · ${n.act16.toLocaleString("bg-BG")} с Акт 16 · ${n.permits.toLocaleString("bg-BG")} разрешения`));
  }
  if (parcels.length) items.push(h("li", null, h("a", { class: "all", href: safeUrl(data.checkUrl), target: "_blank", rel: "noopener" }, "Всички резултати в akt16.org →")));
  results.replaceChildren(...items);
}

let timer = 0;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => quickSearch(input.value.replace(/\s+/g, " ").trim().slice(0, 120)), 350);
});

(async () => {
  try {
    const stored = (await api.storage.local.get("enabled")) || {};
    enabled.checked = stored.enabled !== false;
  } catch (e) {
    /* keep the default */
  }
})();
enabled.addEventListener("change", () => {
  try {
    api.storage.local.set({ enabled: enabled.checked });
  } catch (e) {
    /* storage unavailable */
  }
});
input.focus();
