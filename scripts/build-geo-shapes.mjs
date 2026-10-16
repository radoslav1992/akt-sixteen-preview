// Builds simplified SVG paths for the static maps (Sofia municipality and Bulgaria).
// Source: https://github.com/yurukov/Bulgaria-geocoding (settlement lands and provinces, derived from OpenStreetMap).
// Run manually when the source changes: node scripts/build-geo-shapes.mjs
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/yurukov/Bulgaria-geocoding/master/";
const OUT = new URL("../src/data/geo-shapes.json", import.meta.url);
const EKATTE = JSON.parse(readFileSync(new URL("../data/geo/ekatte-sofia.json", import.meta.url), "utf8"));

async function load(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

function projector(bbox, width) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const scale = width / ((maxLng - minLng) * k);
  const height = (maxLat - minLat) * scale;
  return {
    width, height: Math.round(height), k, scale, bbox,
    project: ([lng, lat]) => [(lng - minLng) * k * scale, (maxLat - lat) * scale],
  };
}

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (max > sq && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

function rings(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function toPath(geometry, proj, tolerance) {
  return rings(geometry)
    .map((ring) => simplify(ring.map(proj.project), tolerance))
    .filter((ring) => ring.length >= 4)
    .map((ring) => "M" + ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z")
    .join("");
}

function bboxOf(features) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) for (const ring of rings(f.geometry)) for (const [x, y] of ring) {
    b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  }
  return b;
}

const settlements = await load("settlements.geojson");
const sofia = settlements.features.filter((f) => f.properties.nuts4 === "SOF46");
const sofiaBox = bboxOf(sofia);
const pad = 0.01;
const sofiaProj = projector([sofiaBox[0] - pad, sofiaBox[1] - pad, sofiaBox[2] + pad, sofiaBox[3] + pad], 800);

const provinces = await load("provinces.geojson");
const bgBox = bboxOf(provinces.features);
const bgProj = projector(bgBox, 600);

const shapes = {
  _source: "Simplified from https://github.com/yurukov/Bulgaria-geocoding (OpenStreetMap-derived). Regenerate with scripts/build-geo-shapes.mjs.",
  sofia: {
    width: sofiaProj.width, height: sofiaProj.height, bbox: sofiaProj.bbox,
    settlements: sofia.map((f) => ({
      ekatte: f.properties.ekatte,
      name: EKATTE[f.properties.ekatte]?.name ?? "",
      d: toPath(f.geometry, sofiaProj, 0.8),
    })),
  },
  bulgaria: {
    width: bgProj.width, height: bgProj.height, bbox: bgProj.bbox,
    provinces: provinces.features.map((f) => ({ nuts3: f.properties.nuts3, d: toPath(f.geometry, bgProj, 0.6) })),
  },
};

writeFileSync(OUT, JSON.stringify(shapes));
console.log(`Wrote ${OUT.pathname}: ${sofia.length} Sofia settlements, ${provinces.features.length} provinces, ${JSON.stringify(shapes).length} bytes`);
