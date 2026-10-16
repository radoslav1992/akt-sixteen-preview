#!/usr/bin/env node
/**
 * Builds data/geo/ekatte-sofia.json: EKATTE code → { name, lat, lng } for every
 * settlement in Sofia municipality (municipality code SOF46), including the
 * city itself (68134).
 *
 * Usage:
 *   node scripts/build-ekatte.mjs              # downloads the CSV from GitHub
 *   node scripts/build-ekatte.mjs local.csv    # uses an already downloaded copy
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SOURCE_URL =
  "https://raw.githubusercontent.com/yurukov/Bulgaria-geocoding/master/settlements_loc.csv";
export const MUNICIPALITY_CODE = "SOF46";
export const OUTPUT_FILE = resolve(__dirname, "..", "data", "geo", "ekatte-sofia.json");

/** Minimal RFC 4180 parser (quoted fields, "" escapes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = String(text).replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** CSV text → { "<ekatte>": { name, lat, lng } } for municipality SOF46. */
export function buildEkatte(csvText, municipalityCode = MUNICIPALITY_CODE) {
  const [header, ...rows] = parseCsv(csvText);
  const col = (name) => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`CSV is missing the "${name}" column (got: ${header.join(", ")})`);
    return idx;
  };
  const iName = col("name");
  const iEkatte = col("ekatte");
  const iMunicipality = col("municipality code");
  const iGeo = col("geo");

  const out = {};
  for (const row of rows) {
    if (row[iMunicipality] !== municipalityCode) continue;
    const code = String(row[iEkatte]).trim().padStart(5, "0");
    // NB: the geo column is "lng,lat" (longitude first).
    const [lng, lat] = String(row[iGeo]).split(",").map(Number);
    if (!/^\d{5}$/.test(code) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out[code] = { name: row[iName].trim(), lat: round5(lat), lng: round5(lng) };
  }
  if (!out["68134"]) throw new Error("EKATTE 68134 (София) not found in the CSV");
  return out;
}

/** Stable, diff-friendly JSON: one settlement per line, sorted by EKATTE. */
export function serializeEkatte(map, sourceUrl = SOURCE_URL) {
  const source = `${sourceUrl} (municipality code ${MUNICIPALITY_CODE}); built by scripts/build-ekatte.mjs; coordinates rounded to 5 decimals`;
  const lines = [`  "_source": ${JSON.stringify(source)}`];
  for (const code of Object.keys(map).sort()) {
    const { name, lat, lng } = map[code];
    lines.push(`  ${JSON.stringify(code)}: ${JSON.stringify({ name, lat, lng })}`);
  }
  return `{\n${lines.join(",\n")}\n}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const [localPath] = argv;
  let text;
  if (localPath) {
    text = readFileSync(localPath, "utf8");
  } else {
    const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "akt16.org-build-ekatte/1.0 (+https://akt16.org)" } });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${SOURCE_URL}`);
    text = await res.text();
  }
  const map = buildEkatte(text);
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, serializeEkatte(map));
  console.log(`Wrote ${Object.keys(map).length} settlements to ${OUTPUT_FILE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
