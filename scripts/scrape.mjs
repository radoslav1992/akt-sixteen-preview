import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://nag.sofia.bg";
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const SEARCH_QUERY_REGEX = /searchQueryId=([a-f0-9-]+)/;
const DATA_DIR = resolve(__dirname, "..", "data");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const REGISTERS = {
  act16: {
    id: "act16",
    label: "Акт 16 — Удостоверения за експлоатация",
    pagePath: "/RegisterCertificateForExploitationBuildings",
    searchPath: "/RegisterCertificateForExploitationBuildings/Search",
    readPath: "/RegisterCertificateForExploitationBuildings/Read",
    outputFile: "certificates.json",
    dataKey: "certificates",
  },
  permits: {
    id: "permits",
    label: "Разрешения за строеж",
    pagePath: "/RegisterBuildingPermitsPortal/Index",
    searchPath: "/RegisterBuildingPermitsPortal/Search",
    readPath: "/RegisterBuildingPermitsPortal/Read",
    outputFile: "permits.json",
    dataKey: "permits",
  },
};

function buildDateRange(daysBack = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);

  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

  return { from: fmt(from), to: fmt(to) };
}

async function initSession(register) {
  const res = await fetch(`${BASE_URL}${register.pagePath}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  const html = await res.text();
  const cookies = res.headers.getSetCookie?.() ?? [];
  const match = html.match(SEARCH_QUERY_REGEX);

  if (!match) {
    throw new Error(
      `Could not extract searchQueryId from ${register.label}`
    );
  }

  return {
    searchQueryId: match[1],
    cookieHeader: cookies.map((c) => c.split(";")[0]).join("; "),
  };
}

async function submitSearch(register, searchQueryId, cookieHeader, dateRange) {
  const params = new URLSearchParams({
    searchQueryId,
    FromDate: dateRange.from,
    ToDate: dateRange.to,
    StatusId: "",
  });

  const res = await fetch(`${BASE_URL}${register.searchPath}?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieHeader,
      Referer: `${BASE_URL}${register.pagePath}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Search failed for ${register.label}: ${res.status}`);
  }

  return res.text();
}

async function fetchPage(register, searchQueryId, cookieHeader, page) {
  const params = new URLSearchParams({
    searchQueryId,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });

  const res = await fetch(`${BASE_URL}${register.readPath}?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
      Cookie: cookieHeader,
      Referer: `${BASE_URL}${register.pagePath}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Read failed for ${register.label} page ${page}: ${res.status}`
    );
  }

  return res.json();
}

export function normalizeRecord(raw) {
  const [number, dateStr] = (raw.Number ?? "").split("/");
  return {
    number: number?.trim() ?? "",
    date: dateStr?.trim() ?? "",
    documentType: raw.DocumentTypeName ?? "",
    status: raw.Status ?? null,
    takeEffect: raw.TakeEffect?.DateTime ?? null,
    issuer: raw.Issuer ?? "",
    employer: raw.Employer ?? "",
    constructionOversight: raw.ConstructionalOversightName ?? "",
    object: raw.Object ?? "",
    region: raw.Region ?? "",
    scope: raw.Scope ?? "",
  };
}

/** @deprecated Use normalizeRecord instead */
export const normalizeCertificate = normalizeRecord;

function loadExisting(outputFile) {
  const filePath = resolve(DATA_DIR, outputFile);
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    return raw.records ?? raw.certificates ?? raw.permits ?? [];
  } catch {
    return [];
  }
}

function mergeAndDeduplicate(existing, incoming) {
  const seen = new Set(existing.map((c) => `${c.number}/${c.date}`));
  const merged = [...existing];

  for (const record of incoming) {
    const key = `${record.number}/${record.date}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(record);
    }
  }

  return merged.sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
  );
}

export function parseDate(dateStr) {
  const [day, month, year] = dateStr.split(".");
  return new Date(+year, +month - 1, +day);
}

export async function scrapeRegister(register, daysBack = 90) {
  console.log(`\n--- Scraping: ${register.label} (last ${daysBack} days) ---`);

  const dateRange = buildDateRange(daysBack);
  console.log(`Date range: ${dateRange.from} - ${dateRange.to}`);

  const { searchQueryId, cookieHeader } = await initSession(register);
  console.log(`Session initialized (queryId: ${searchQueryId})`);

  await submitSearch(register, searchQueryId, cookieHeader, dateRange);
  console.log("Search submitted");

  const allRecords = [];
  let page = 1;
  let total = 0;

  while (page <= MAX_PAGES) {
    const result = await fetchPage(register, searchQueryId, cookieHeader, page);
    total = result.Total ?? 0;

    if (!result.Data?.length) break;

    const normalized = result.Data.map(normalizeRecord);
    allRecords.push(...normalized);

    console.log(
      `Page ${page}: ${result.Data.length} records (${allRecords.length}/${total})`
    );

    if (allRecords.length >= total) break;
    page++;
  }

  console.log(`Scraped ${allRecords.length} records for ${register.label}`);
  return allRecords;
}

export async function scrapeAndSave(registerIds = ["act16", "permits"], daysBack = 90) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const results = {};

  for (const id of registerIds) {
    const register = REGISTERS[id];
    if (!register) {
      console.warn(`Unknown register: ${id}, skipping`);
      continue;
    }

    const incoming = await scrapeRegister(register, daysBack);
    const existing = loadExisting(register.outputFile);
    const merged = mergeAndDeduplicate(existing, incoming);

    const output = {
      lastUpdated: new Date().toISOString(),
      registerId: register.id,
      registerLabel: register.label,
      total: merged.length,
      [register.dataKey]: merged,
    };

    const filePath = resolve(DATA_DIR, register.outputFile);
    writeFileSync(filePath, JSON.stringify(output, null, 2), "utf-8");
    console.log(
      `Saved ${merged.length} records to ${register.outputFile} (${merged.length - existing.length} new)`
    );

    results[id] = output;
  }

  return results;
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const daysBack = parseInt(process.argv[2] ?? "90", 10);
  const registerArg = process.argv[3];
  const registerIds = registerArg
    ? registerArg.split(",")
    : Object.keys(REGISTERS);

  scrapeAndSave(registerIds, daysBack).catch((err) => {
    console.error("Scrape failed:", err);
    process.exit(1);
  });
}
