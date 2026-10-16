#!/usr/bin/env node
/**
 * Incremental geocoder for akt16.org.
 *
 * Reads data/certificates.json + data/permits.json, works out candidate
 * Nominatim queries per record (scripts/geo-lib.mjs), geocodes the ones that
 * are not cached yet (newest records first, strictly sequential, ≤ 1 req/s)
 * and always rewrites data/geo/points.json from the cache + EKATTE centres.
 *
 * Usage:
 *   node scripts/geocode.mjs [--limit N] [--max-minutes M] [--no-network]
 *
 *   --limit N        max Nominatim requests in this run (default 400)
 *   --max-minutes M  stop starting new requests after M minutes (default 8)
 *   --no-network     do not call Nominatim; rebuild points.json from cache only
 *
 * Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PRECISION_NAMES,
  inSofiaBBox,
  planRecord,
  recordKey,
  resolvePoint,
  roundCoord,
  usableHit,
} from "./geo-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DATA_DIR = resolve(__dirname, "..", "data");
export const REGISTERS = [
  { registerId: "act16", file: "certificates.json", dataKey: "certificates" },
  { registerId: "permits", file: "permits.json", dataKey: "permits" },
];

export const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_PARAMS =
  "format=jsonv2&limit=1&countrycodes=bg&accept-language=bg&viewbox=22.90,42.95,23.70,42.40&bounded=1";
export const USER_AGENT = "akt16.org-geocoder/1.0 (+https://akt16.org; info@akt16.org)";

export const DEFAULT_LIMIT = 400;
export const DEFAULT_MAX_MINUTES = 8;
/** Pause between two consecutive requests (Nominatim allows at most 1 req/s). */
export const MIN_REQUEST_INTERVAL_MS = 1100;
export const MISS_RETRY_DAYS = 60;
export const MAX_RETRIES = 4;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 60_000;
/** Stop the run after this many queries in a row failed even after retries. */
export const MAX_CONSECUTIVE_FAILURES = 3;
/** Persist the cache every N requests so a killed run loses little work. */
export const CHECKPOINT_EVERY = 25;
export const REQUEST_TIMEOUT_MS = 30_000;

// Nominatim place_rank: 16 = city, 17–25 = suburbs/quarters/neighbourhoods/
// localities, 26–27 = streets, 30 = buildings/POIs.
const MIN_ADDRESS_RANK = 26;
const MIN_LOCALITY_RANK = 17;
const MAX_LOCALITY_RANK = 25;

const DAY_MS = 24 * 60 * 60 * 1000;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI / files
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { limit: DEFAULT_LIMIT, maxMinutes: DEFAULT_MAX_MINUTES, network: true, help: false };
  const args = [...argv];
  const number = (name, raw) => {
    const n = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(n) || n < 0) {
      throw new Error(`${name} expects a non-negative number, got "${raw}"`);
    }
    return n;
  };
  while (args.length) {
    const arg = args.shift();
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    switch (flag) {
      case "--limit":
        opts.limit = Math.floor(number(flag, inline ?? args.shift()));
        break;
      case "--max-minutes":
        opts.maxMinutes = number(flag, inline ?? args.shift());
        break;
      case "--no-network":
        opts.network = false;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

const dateRank = (date) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(date ?? ""));
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0;
};

/** Newest first; ties broken by register and number so the order is stable. */
export function sortNewestFirst(items) {
  return [...items].sort(
    (a, b) =>
      dateRank(b.record.date) - dateRank(a.record.date) ||
      (a.registerId < b.registerId ? -1 : a.registerId > b.registerId ? 1 : 0) ||
      (parseInt(b.record.number, 10) || 0) - (parseInt(a.record.number, 10) || 0),
  );
}

/** `[{ registerId, record }]` for both registers, newest first. */
export function loadRecords(dataDir) {
  const items = [];
  for (const { registerId, file, dataKey } of REGISTERS) {
    const data = readJson(resolve(dataDir, file), null);
    for (const record of data?.[dataKey] ?? []) items.push({ registerId, record });
  }
  return sortNewestFirst(items);
}

export function loadCache(path) {
  const data = readJson(path, null);
  if (!data || data.version !== 1 || typeof data.entries !== "object" || !data.entries) {
    return { version: 1, entries: {} };
  }
  return { version: 1, entries: { ...data.entries } };
}

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Sorted keys, one cache entry per line. */
export function serializeCache(cache) {
  const keys = Object.keys(cache.entries).sort(byKey);
  if (keys.length === 0) return `{\n "version": 1,\n "entries": {}\n}\n`;
  const lines = keys.map((k) => {
    const e = cache.entries[k];
    const value = e.miss ? { miss: true, at: e.at } : { lat: e.lat, lng: e.lng, at: e.at };
    return `  ${JSON.stringify(k)}: ${JSON.stringify(value)}`;
  });
  return `{\n "version": 1,\n "entries": {\n${lines.join(",\n")}\n }\n}\n`;
}

/** Sorted record keys, one point per line. */
export function serializePoints({ updatedAt, counts, points }) {
  const keys = Object.keys(points).sort(byKey);
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(points[k])}`).join(",\n");
  const { address, locality, settlement, none } = counts;
  return (
    `{\n "version": 1,\n "updatedAt": ${JSON.stringify(updatedAt)},\n` +
    ` "counts": ${JSON.stringify({ address, locality, settlement, none })},\n` +
    ` "points": {${keys.length ? `\n${body}\n ` : ""}}\n}\n`
  );
}

// ---------------------------------------------------------------------------
// Nominatim
// ---------------------------------------------------------------------------

export function nominatimUrl(q) {
  return `${NOMINATIM_SEARCH_URL}?${NOMINATIM_PARAMS}&q=${encodeURIComponent(q)}`;
}

/**
 * Turns a Nominatim jsonv2 response into a hit or a miss. Results outside the
 * Sofia bbox, address results coarser than a street and locality results that
 * are not suburb/quarter/locality-like (e.g. the whole city) are misses.
 */
export function interpretResults(body, kind) {
  if (!Array.isArray(body) || body.length === 0) return { status: "miss", reason: "no result" };
  const top = body[0];
  const lat = Number(top?.lat);
  const lng = Number(top?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: "miss", reason: "no coordinates" };
  if (!inSofiaBBox(lat, lng)) return { status: "miss", reason: "outside Sofia bbox" };
  const rank = Number(top.place_rank);
  if (Number.isFinite(rank)) {
    if (kind === "address" && rank < MIN_ADDRESS_RANK) return { status: "miss", reason: `too coarse (rank ${rank})` };
    if (kind === "locality" && (rank < MIN_LOCALITY_RANK || rank > MAX_LOCALITY_RANK)) {
      return { status: "miss", reason: `not a locality (rank ${rank})` };
    }
  }
  return { status: "hit", lat, lng };
}

function backoffDelay(attempt, res) {
  const retryAfter = Number(res?.headers?.get?.("retry-after"));
  const base = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_BASE_MS * 2 ** attempt;
  return Math.max(MIN_REQUEST_INTERVAL_MS, Math.min(base, BACKOFF_MAX_MS));
}

/**
 * One query with retries. Resolves to
 *   { status: "hit", lat, lng } | { status: "miss", reason }
 *   | { status: "error", reason }   (transient; nothing is cached)
 *   | { status: "fatal", reason }   (blocked/forbidden; stop the run)
 */
export async function geocodeQuery(query, { fetchImpl = globalThis.fetch, sleep = defaultSleep, log = () => {} } = {}) {
  const url = nominatimUrl(query.q);
  let lastError = "unknown error";
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = `network error: ${err?.message ?? err}`;
    }
    if (res) {
      if (res.ok) {
        try {
          return interpretResults(await res.json(), query.kind);
        } catch (err) {
          lastError = `invalid JSON: ${err?.message ?? err}`;
        }
      } else if ([401, 403, 418].includes(res.status)) {
        return { status: "fatal", reason: `HTTP ${res.status}` };
      } else if (res.status !== 429 && res.status < 500) {
        return { status: "miss", reason: `HTTP ${res.status}` };
      } else {
        lastError = `HTTP ${res.status}`;
      }
    }
    if (attempt >= MAX_RETRIES) return { status: "error", reason: lastError };
    const delay = backoffDelay(attempt, res);
    log(`  ${lastError}; retrying in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** True when a query has to be (re)sent: not cached, or a miss older than 60 days. */
export function needsLookup(entry, nowMs) {
  if (!entry) return true;
  if (!entry.miss) return false;
  const at = Date.parse(entry.at);
  return !Number.isFinite(at) || nowMs - at >= MISS_RETRY_DAYS * DAY_MS;
}

/**
 * Geocodes what is missing, record by record (newest first). For each record
 * the queries are tried in order and the record is done as soon as one of
 * them is a usable hit, so locality queries are only sent when the address
 * did not resolve. Mutates `cache.entries`.
 */
export async function runGeocoder({
  items,
  cache,
  ekatte = null,
  limit = DEFAULT_LIMIT,
  maxMinutes = DEFAULT_MAX_MINUTES,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  now = Date.now,
  log = () => {},
  onCheckpoint = null,
}) {
  const entries = cache.entries;
  const deadline = now() + maxMinutes * 60_000;
  const stats = { attempted: 0, hit: 0, miss: 0, error: 0, stopReason: "nothing left to geocode" };
  let consecutiveFailures = 0;

  outer: for (const { record } of items) {
    const { queries, centre } = planRecord(record, ekatte);
    for (const query of queries) {
      const cached = entries[query.q];
      if (usableHit(cached, centre)) break;
      if (!needsLookup(cached, now())) continue;

      if (stats.attempted >= limit) {
        stats.stopReason = `request limit (${limit}) reached`;
        break outer;
      }
      if (stats.attempted > 0) await sleep(MIN_REQUEST_INTERVAL_MS);
      if (now() >= deadline) {
        stats.stopReason = `time budget (${maxMinutes} min) used up`;
        break outer;
      }

      stats.attempted++;
      const result = await geocodeQuery(query, { fetchImpl, sleep, log });
      const at = new Date(now()).toISOString();
      if (result.status === "hit") {
        entries[query.q] = { lat: roundCoord(result.lat, 6), lng: roundCoord(result.lng, 6), at };
        stats.hit++;
        consecutiveFailures = 0;
      } else if (result.status === "miss") {
        entries[query.q] = { miss: true, at };
        stats.miss++;
        consecutiveFailures = 0;
      } else {
        stats.error++;
        log(`  ! ${query.q}: ${result.reason}`);
        if (result.status === "fatal") {
          stats.stopReason = `Nominatim refused the request (${result.reason})`;
          break outer;
        }
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stats.stopReason = `${consecutiveFailures} consecutive failures (${result.reason})`;
          break outer;
        }
      }
      if (onCheckpoint && stats.attempted % CHECKPOINT_EVERY === 0) await onCheckpoint();
      if (usableHit(entries[query.q], centre)) break;
    }
  }
  return stats;
}

/** Points + per-precision counts for all records. */
export function buildPoints(items, cache, ekatte = null) {
  const counts = { address: 0, locality: 0, settlement: 0, none: 0 };
  const points = {};
  for (const { registerId, record } of items) {
    const point = resolvePoint(record, registerId, cache, ekatte);
    if (!point) {
      counts.none++;
      continue;
    }
    counts[PRECISION_NAMES[point[2]]]++;
    points[recordKey(registerId, record)] = point;
  }
  return { counts, points };
}

/** Unique queries that would still be sent if every lookup missed (upper bound). */
export function countPending(items, cache, ekatte, nowMs) {
  const pending = new Set();
  for (const { record } of items) {
    const { queries, centre } = planRecord(record, ekatte);
    for (const query of queries) {
      const cached = cache.entries[query.q];
      if (usableHit(cached, centre)) break;
      if (needsLookup(cached, nowMs)) pending.add(query.q);
    }
  }
  return pending.size;
}

const pct = (n, total) => (total ? ((100 * n) / total).toFixed(1) : "0.0");

export async function main(argv = process.argv.slice(2), deps = {}) {
  const opts = parseArgs(argv);
  const log = deps.log ?? console.log;
  if (opts.help) {
    log("Usage: node scripts/geocode.mjs [--limit N] [--max-minutes M] [--no-network]");
    return null;
  }
  const now = deps.now ?? Date.now;
  const dataDir = deps.dataDir ?? DEFAULT_DATA_DIR;
  const geoDir = resolve(dataDir, "geo");
  const cachePath = resolve(geoDir, "cache.json");
  const pointsPath = resolve(geoDir, "points.json");

  const items = loadRecords(dataDir);
  const ekatte = readJson(resolve(geoDir, "ekatte-sofia.json"), null);
  if (!ekatte) log("[geocode] warning: data/geo/ekatte-sofia.json missing — run scripts/build-ekatte.mjs");
  const cache = loadCache(cachePath);
  const saveCache = () => writeFileAtomic(cachePath, serializeCache(cache));

  let stats = { attempted: 0, hit: 0, miss: 0, error: 0, stopReason: "--no-network" };
  if (opts.network) {
    log(`[geocode] ${items.length} records, ${Object.keys(cache.entries).length} cached queries; ` +
      `limit ${opts.limit} requests / ${opts.maxMinutes} min`);
    stats = await runGeocoder({
      items,
      cache,
      ekatte,
      limit: opts.limit,
      maxMinutes: opts.maxMinutes,
      fetchImpl: deps.fetch ?? globalThis.fetch,
      sleep: deps.sleep ?? defaultSleep,
      now,
      log,
      onCheckpoint: saveCache,
    });
  }
  saveCache();

  const { counts, points } = buildPoints(items, cache, ekatte);
  const previous = readJson(pointsPath, null);
  const unchanged =
    previous &&
    JSON.stringify(previous.counts) === JSON.stringify(counts) &&
    JSON.stringify(previous.points) === JSON.stringify(Object.fromEntries(Object.keys(points).sort(byKey).map((k) => [k, points[k]])));
  const updatedAt = unchanged && previous.updatedAt ? previous.updatedAt : new Date(now()).toISOString();
  writeFileAtomic(pointsPath, serializePoints({ updatedAt, counts, points }));

  const pending = countPending(items, cache, ekatte, now());
  const total = items.length;
  log(
    `[geocode] queries: attempted ${stats.attempted}, hit ${stats.hit}, miss ${stats.miss}, ` +
      `error ${stats.error} — stopped: ${stats.stopReason}`,
  );
  log(
    `[geocode] coverage of ${total} records: address ${counts.address} (${pct(counts.address, total)}%), ` +
      `locality ${counts.locality} (${pct(counts.locality, total)}%), ` +
      `settlement ${counts.settlement} (${pct(counts.settlement, total)}%), ` +
      `none ${counts.none} (${pct(counts.none, total)}%)`,
  );
  log(`[geocode] cache: ${Object.keys(cache.entries).length} queries; still to try: ≤ ${pending}`);
  return { stats, counts, pending };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
