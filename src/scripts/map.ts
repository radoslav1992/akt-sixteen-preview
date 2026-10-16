// Interactive construction map: district bubbles, village/town aggregates and geocoded documents.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { localizeLabels } from "./map-labels";

interface MapData {
  updatedAt: string;
  years: number[];
  types: string[];
  districts: Array<{ n: string; s: string; lat: number; lng: number }>;
  settlements: Array<{ n: string; s: string; lat: number; lng: number; town: boolean }>;
  recs: Array<[number, number, number, number, number]>; // reg, yearIdx, typeIdx, districtIdx, settlementIdx
  pts: Array<[number, number, number, number, string, string, string, string]>; // lat, lng, precision, recIdx, key, number, date, text
}

// Basemap: OpenFreeMap vector styles (no API key or usage limits). Positron and Dark are the designs the map
// used from CARTO before CARTO started requiring an API key. Without WebGL, or if OpenFreeMap is unreachable,
// OpenStreetMap's standard raster tiles are used instead (darkened with a CSS filter in the dark theme).
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const VECTOR_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const RASTER_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const RASTER_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const REG_LABEL = ["Акт 16", "Разрешение за строеж"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => n.toLocaleString("bg-BG").replace(/ /g, " ");

const theme = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function addBasemap(map: L.Map, el: HTMLElement): Promise<void> {
  let vector: L.Layer | null = null;
  const useRaster = () => {
    if (vector) map.removeLayer(vector);
    vector = null;
    L.tileLayer(RASTER_TILES, { attribution: RASTER_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    const sync = () => el.classList.toggle("map--raster-dark", theme() === "dark");
    sync();
    document.addEventListener("themechange", sync);
  };
  if (!hasWebGL()) return useRaster();
  try {
    const [{ maplibreGL }, { setWorkerUrl }, { default: workerUrl }] = await Promise.all([
      import("@maplibre/maplibre-gl-leaflet"),
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]);
    // MapLibre 6 loads its worker from next to its own file, which bundling moves; without a worker no tiles are
    // drawn. Point it at the worker Vite builds.
    setWorkerUrl(workerUrl);
    // The plugin turns MapLibre's own control off and shows this in Leaflet's attribution box.
    const layer = maplibreGL({ style: STYLES[theme()], attributionControl: { customAttribution: VECTOR_ATTRIBUTION } });
    vector = layer.addTo(map);
    const gl = layer.getMaplibreMap();
    const fallback = (reason: string, detail?: unknown) => {
      if (!vector) return;
      console.warn(`[map] ${reason}, using raster tiles`, detail ?? "");
      useRaster();
    };
    // An error before the style has loaded means the style itself failed (OpenFreeMap down or blocked). Later
    // errors (a missing tile or font) are left to MapLibre.
    let styleLoaded = false;
    gl.on("error", (e) => { if (!styleLoaded) fallback("vector style unavailable", e.error); });
    // A worker that cannot start raises no map error and the style never finishes loading; the map just stays
    // empty. If no tile has been decoded 15 s after the map was created (while the tab is visible), switch to
    // raster tiles.
    let tileDecoded = false;
    let watchdog = 0;
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (tileDecoded) return;
        if (document.hidden) armWatchdog();
        else fallback("no map tiles decoded");
      }, 15000);
    };
    gl.on("sourcedata", (e) => { if (e.tile) tileDecoded = true; });
    armWatchdog();
    gl.on("style.load", () => {
      styleLoaded = true;
      localizeLabels(gl);
    });
    document.addEventListener("themechange", () => {
      if (!vector) return;
      styleLoaded = false;
      gl.setStyle(STYLES[theme()]);
    });
  } catch (err) {
    console.error("[map] vector basemap failed", err);
    useRaster();
  }
}

export async function initMap(): Promise<void> {
  const el = document.getElementById("map");
  if (!el) return;

  const map = L.map(el, { zoomControl: true, attributionControl: true, minZoom: 9, maxZoom: 18 }).setView([42.69, 23.33], 11);
  void addBasemap(map, el);

  let data: MapData;
  try {
    const res = await fetch("/api/map.json");
    data = await res.json();
  } catch {
    el.insertAdjacentHTML("beforeend", '<p class="notice" style="position:absolute;z-index:500;margin:1rem">Не успяхме да заредим данните за картата.</p>');
    return;
  }

  const districtLayer = L.layerGroup().addTo(map);
  const settlementLayer = L.layerGroup().addTo(map);
  const pointLayer = (L as any).markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
    iconCreateFunction: (cluster: any) => {
      const n = cluster.getChildCount();
      const size = n < 10 ? 30 : n < 100 ? 36 : 44;
      return L.divIcon({ html: `<div class="map-cluster" style="width:${size}px;height:${size}px">${n}</div>`, className: "", iconSize: [size, size] });
    },
  }).addTo(map);

  const state = { regs: new Set([0, 1]), year: -1, type: -1 };
  const matches = (r: MapData["recs"][number]) =>
    state.regs.has(r[0]) && (state.year < 0 || r[1] === state.year) && (state.type < 0 || r[2] === state.type);

  function render() {
    const districtCounts = data.districts.map(() => [0, 0]);
    const settlementCounts = data.settlements.map(() => [0, 0]);
    let total = 0;
    for (const r of data.recs) {
      if (!matches(r)) continue;
      total++;
      if (r[4] >= 0) settlementCounts[r[4]][r[0]]++;
      else if (r[3] >= 0) districtCounts[r[3]][r[0]]++;
    }
    document.getElementById("map-count")!.textContent = fmt(total);

    districtLayer.clearLayers();
    const max = Math.max(1, ...districtCounts.map(([a, b]) => a + b));
    data.districts.forEach((d, i) => {
      const [a, p] = districtCounts[i];
      const n = a + p;
      if (!n) return;
      const circle = L.circleMarker([d.lat, d.lng], {
        radius: 8 + Math.sqrt(n / max) * 34,
        color: "#121418",
        weight: 1.5,
        fillColor: "#ffc21a",
        fillOpacity: 0.55,
      });
      circle.bindTooltip(`${esc(d.n)} · ${fmt(n)}`, { className: "map-label", direction: "center", permanent: false });
      circle.bindPopup(`<div class="map-popup"><h3>Район ${esc(d.n)}</h3><p>Акт 16: <b>${fmt(a)}</b> · Разрешения: <b>${fmt(p)}</b></p><p class="muted">Без точна локация или в градската част</p><p><a href="/region/${d.s}/">Към района →</a></p></div>`);
      circle.addTo(districtLayer);
    });

    settlementLayer.clearLayers();
    data.settlements.forEach((s, i) => {
      const [a, p] = settlementCounts[i];
      const n = a + p;
      if (!n) return;
      const w = n < 100 ? 30 : 38;
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ html: `<div class="map-village" style="width:${w}px;height:24px">${n}</div>`, className: "", iconSize: [w, 24] }),
        title: `${s.town ? "гр." : "с."} ${s.n}: ${n}`,
        keyboard: true,
      });
      marker.bindPopup(`<div class="map-popup"><h3>${s.town ? "гр." : "с."} ${esc(s.n)}</h3><p>Акт 16: <b>${fmt(a)}</b> · Разрешения: <b>${fmt(p)}</b></p>${s.s ? `<p><a href="/neighborhood/${s.s}/">Всички документи →</a></p>` : ""}</div>`);
      marker.addTo(settlementLayer);
    });

    pointLayer.clearLayers();
    const markers: L.Marker[] = [];
    for (const pt of data.pts) {
      const rec = data.recs[pt[3]];
      if (!matches(rec)) continue;
      const [lat, lng, precision, , key, number, date, text] = pt;
      const [registerId, slug] = key.split(":");
      const m = L.marker([lat, lng], {
        icon: L.divIcon({ html: `<div class="map-dot map-dot--${rec[0]}"></div>`, className: "", iconSize: [14, 14] }),
        title: `${REG_LABEL[rec[0]]} № ${number}`,
      });
      m.bindPopup(`<div class="map-popup"><h3>${REG_LABEL[rec[0]]} № ${esc(number)}</h3><p>${esc(date)}${precision === 2 ? " · приблизително (по квартал)" : ""}</p><p>${esc(text)}</p><p><a href="/register/${registerId}/${slug}/">Виж документа →</a></p></div>`);
      (m as any)._akt16Key = key;
      markers.push(m);
    }
    pointLayer.addLayers(markers);
    return markers;
  }

  let markers = render() ?? [];

  document.querySelectorAll<HTMLInputElement>('input[name="reg"]').forEach((input) =>
    input.addEventListener("change", () => {
      const n = +input.value;
      if (input.checked) state.regs.add(n);
      else state.regs.delete(n);
      markers = render() ?? [];
    })
  );
  document.querySelectorAll<HTMLButtonElement>("#year-chips [data-year]").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#year-chips .chip").forEach((c) => c.classList.remove("chip--active"));
      btn.classList.add("chip--active");
      state.year = btn.dataset.year === "all" ? -1 : data.years.indexOf(+btn.dataset.year!);
      markers = render() ?? [];
    })
  );
  document.getElementById("type-filter")!.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    state.type = v ? data.types.indexOf(v) : -1;
    markers = render() ?? [];
  });
  const toggleLayer = (id: string, layer: L.Layer) =>
    document.getElementById(id)!.addEventListener("change", (e) => {
      if ((e.target as HTMLInputElement).checked) layer.addTo(map);
      else map.removeLayer(layer);
    });
  toggleLayer("layer-districts", districtLayer);
  toggleLayer("layer-settlements", settlementLayer);
  toggleLayer("layer-points", pointLayer);

  // Deep link from a document page: /map/#act16:1126-13102026
  const focus = decodeURIComponent(location.hash.slice(1));
  if (focus) {
    const target = markers.find((m) => (m as any)._akt16Key === focus);
    if (target) pointLayer.zoomToShowLayer(target, () => target.openPopup());
  }
}
