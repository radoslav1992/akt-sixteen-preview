// Акт 16 Тракер — background worker (Chrome service worker / Firefox event page).
// The only place that talks to akt16.org: content scripts and the popup ask it via messages.
"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const SITE = "https://akt16.org";
const LOOKUP = `${SITE}/api/lookup/`;
const MENU_ID = "akt16-check-selection";
const PARAMS = ["q", "cad", "street", "hood"];
const TTL = 10 * 60 * 1000;
const MAX_CACHE = 100;
const TIMEOUT = 8000;

// Small in-memory cache; it is lost whenever the browser stops the worker, which is fine.
const cache = new Map();

function toQuery(params) {
  const search = new URLSearchParams();
  for (const key of PARAMS) {
    const value = params && params[key];
    if (typeof value === "string" && value.trim()) search.set(key, value.replace(/\s+/g, " ").trim().slice(0, 120));
  }
  return search.toString();
}

async function lookup(params) {
  const query = toQuery(params);
  if (!query) return { ok: false, error: "empty" };
  const hit = cache.get(query);
  if (hit && Date.now() - hit.time < TTL) return { ok: true, data: hit.data };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${LOOKUP}?${query}`, {
      signal: controller.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    cache.delete(query);
    cache.set(query, { time: Date.now(), data });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "lookup") return false;
  lookup(message.params).then(sendResponse, () => sendResponse({ ok: false }));
  return true; // keeps the channel open for the async answer (Chrome and Firefox)
});

function createMenu() {
  const create = () =>
    api.contextMenus.create(
      { id: MENU_ID, title: "Провери „%s“ в Акт 16", contexts: ["selection"] },
      () => void api.runtime.lastError,
    );
  try {
    const removed = api.contextMenus.removeAll();
    if (removed && typeof removed.then === "function") removed.then(create, create);
    else create();
  } catch (e) {
    create();
  }
}

api.runtime.onInstalled.addListener(createMenu);

api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  const q = String(info.selectionText || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!q) return;
  api.tabs.create({ url: `${SITE}/check/?q=${encodeURIComponent(q)}` });
});
