// Public lookup API (/api/lookup/): parcels, streets and neighbourhoods across both registers.
// Pure logic with no Workers imports, so it runs under vitest as well as in the worker.
// Search indexes are built lazily, once per isolate, so a request only scans prebuilt strings.
import { extractCadastreIds, getRecords, parcelIdOf, recordSlug, slugifyRegion, type Record, type RegisterId } from "./data";
import { getParcelGroups } from "./parcels";
import {
  DISTRICTS,
  NEIGHBORHOOD_PAGE_MIN_DOCS,
  getNeighborhoods,
  neighborhoodFromText,
  neighborhoodLabel,
  neighborhoodOf,
  type NeighborhoodSummary,
} from "./places";
import { isNewApartmentBuilding } from "./classify";
import { readableCase } from "./textcase";
import { dateKey, truncate } from "./format";

const SITE = "https://akt16.org";
export const MAX_PARAM_LENGTH = 120;
const MAX_PARCELS = 8;
const MAX_DOCS_PER_PARCEL = 12;
const MAX_NEW_BUILDINGS = 5;
const NEW_BUILDING_MONTHS = 24;
const TITLE_LENGTH = 110;
const REGISTERS: RegisterId[] = ["permits", "act16"];

export interface LookupParams {
  q?: string;
  cad?: string;
  street?: string;
  hood?: string;
}

export interface LookupDoc { register: RegisterId; number: string; date: string; title: string; url: string }
export interface LookupDocRef { number: string; date: string; url: string }

export interface LookupParcel {
  /** Cadastral identifier (КККР), or null for a document without one. */
  id: string | null;
  region: string;
  neighborhood: string | null;
  /** Latest permit / Акт 16 on the parcel. */
  permit: LookupDocRef | null;
  act16: LookupDocRef | null;
  /** Oldest → newest; at most the latest 12 when the parcel has more (see docCount). */
  docs: LookupDoc[];
  docCount: number;
}

export interface LookupNeighborhood {
  name: string;
  region: string | null;
  url: string | null;
  act16: number;
  permits: number;
  /** New multi-family buildings with Акт 16 in the last 24 months, newest first. */
  newBuildings: Array<Omit<LookupDoc, "register">>;
  /** When the name covers several neighbourhoods (e.g. „Манастирски ливади“ – запад/изток). */
  parts?: Array<{ name: string; url: string | null; act16: number; permits: number }>;
}

export type MatchKind = "cad" | "street" | "q" | "hood";

export interface LookupResult {
  query: LookupParams;
  matchedBy: MatchKind | null;
  checkUrl: string;
  parcels: LookupParcel[];
  neighborhood: LookupNeighborhood | null;
  /** Number of documents that matched (before pulling in the rest of each parcel's history). */
  matched: number;
}

// ---------- Input normalization ----------

const QUOTES = /[„“”"'«»‘’`]/g;
// Words that carry no signal in free-text queries: place markers and the city itself.
const QUERY_STOP = new Set(["ул", "ул.", "бул", "бул.", "кв", "кв.", "ж.к.", "ж.к", "жк", "жк.", "гр", "гр.", "град", "софия", "с.", "м.", "№", "р-н", "район", "местност", "квартал", "обл.", "област"]);
const PLACE_STOP = new Set(["кв", "квартал", "жк", "местност", "село", "гр", "град", "софия", "район", "обл", "област", "столица", "община", "столична"]);
const STREET_PREFIX = new Set(["ул", "улица", "бул", "булевард", "пл", "площад"]);
const STREET_TITLES = new Set(["проф", "акад", "др", "ген", "св", "арх", "инж", "кап", "полк", "ст"]);
const CAD_RE = /^\d{5}(?:\.\d{1,5}){1,5}$/;
const DIRECTION_SUFFIX = /^(?:\d+|запад|изток|север|юг)$/;

function clean(value: string | null | undefined): string {
  if (!value) return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PARAM_LENGTH).trim();
}

/** Cadastral id or prefix: "68134.4082", "68134.4082.123", "68134.4082.123.1.15". */
export function normalizeCad(value: string): string | null {
  const id = value.replace(/\s+/g, "").replace(/,/g, ".").replace(/\.+$/, "");
  return CAD_RE.test(id) ? id : null;
}

/** Lower-case words without punctuation, used for neighbourhood and district names. */
export function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(QUOTES, " ")
    .replace(/в\.\s*з\./g, " вилна зона ")
    .replace(/(\d)\s*[-–]?\s*[а-я](?![а-я])/g, "$1") // "Младост 1А" → "младост 1"
    .replace(/[.,;:()/\\\-–—_]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !PLACE_STOP.has(t) && (t.length > 1 || /^\d$/.test(t)))
    .join(" ");
}

/** Street name as a word sequence: no "ул."/"бул.", titles, quotes or house number. */
export function normalizeStreet(value: string): string {
  const head = value.split(/[,;]|№/)[0];
  const words = head
    .toLowerCase()
    .replace(QUOTES, " ")
    .replace(/[.:()/\\\-–—_]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && STREET_PREFIX.has(words[0])) words.shift();
  const named = words.filter((w) => !STREET_TITLES.has(w) && !(w.length === 1 && /[а-я]/.test(w)));
  // A trailing house number ("Кутловица 9", "България 102А") is not part of the name.
  while (named.length > 1 && /^\d+[а-я]?$/.test(named[named.length - 1]) && /[а-я]/.test(named.join(""))) named.pop();
  return named.join(" ");
}

const isStreetName = (street: string) => street.length >= 2 && /[а-яa-z]/.test(street);

function streetDisplay(value: string): string {
  return value.split(/[,;]|№/)[0].replace(QUOTES, "").replace(/^\s*(ул\.?|улица|бул\.?|булевард)\s*/i, "").trim();
}

export function queryTerms(value: string): string[] {
  const terms = value
    .toLowerCase()
    .replace(QUOTES, " ")
    .replace(/[,;()№]/g, " ")
    .split(/\s+/)
    .map((t) => (/\d\.\d/.test(t) ? t.replace(/\.+$/, "") : t))
    .filter((t) => t && !QUERY_STOP.has(t))
    .map((t) => (/\d/.test(t) ? t : t.replace(/\.+$/, "")))
    .filter((t) => t.length > 1 || /\d/.test(t));
  return [...new Set(terms)];
}

/**
 * Reads and cleans the query string. Returns null when there is nothing usable to search for.
 * Each value is trimmed, stripped of control characters and cut to 120 characters.
 */
export function parseLookupParams(search: URLSearchParams): LookupParams | null {
  const params: LookupParams = {};
  for (const key of ["q", "cad", "street", "hood"] as const) {
    const value = clean(search.get(key));
    if (value) params[key] = value;
  }
  if (params.cad) {
    const cad = normalizeCad(params.cad);
    if (cad) params.cad = cad;
    else delete params.cad;
  }
  const usable =
    !!params.cad ||
    (!!params.q && (queryTerms(params.q).length > 0 || !!normalizeCad(params.q))) ||
    (!!params.street && isStreetName(normalizeStreet(params.street))) ||
    (!!params.hood && normalizePlace(params.hood).length >= 2);
  return usable ? params : null;
}

/** Stable cache key for normalized params (sorted, empty values dropped). */
export function lookupCacheQuery(params: LookupParams): string {
  const search = new URLSearchParams();
  for (const key of ["cad", "hood", "q", "street"] as const) if (params[key]) search.set(key, params[key]!);
  return search.toString();
}

// ---------- Lazily built indexes ----------

interface Entry {
  reg: RegisterId;
  record: Record;
}

let entries: Entry[] | null = null;
let queryHay: string[] | null = null;
const idCache = new WeakMap<Record, string[]>();

function getEntries(): Entry[] {
  if (!entries) entries = REGISTERS.flatMap((reg) => getRecords(reg).map((record) => ({ reg, record })));
  return entries;
}

function idsOf(record: Record): string[] {
  let ids = idCache.get(record);
  if (!ids) idCache.set(record, (ids = extractCadastreIds(record.scope)));
  return ids;
}

const hoodSlugOf = (record: Record) => neighborhoodOf(record)?.slug ?? null;

function getQueryHay(): string[] {
  if (queryHay) return queryHay;
  queryHay = getEntries().map(({ record: r }) =>
    `${r.number} ${r.object} ${r.region} ${r.scope} ${r.employer} ${r.constructionOversight} ${neighborhoodOf(r)?.name ?? ""}`.toLowerCase(),
  );
  return queryHay;
}

/** The scope as space-separated words, so a street name can be matched on word boundaries. */
const scopeWords = (record: Record) => ` ${record.scope.toLowerCase().replace(QUOTES, "").replace(/[\s.,;:()/\\\-–—№]+/g, " ")} `;

interface PlaceIndex {
  hoods: Map<string, NeighborhoodSummary[]>;
  districts: Map<string, string>;
  names: Array<{ key: string; hood?: NeighborhoodSummary; district?: string }>;
}

let placeIndex: PlaceIndex | null = null;

function getPlaceIndex(): PlaceIndex {
  if (placeIndex) return placeIndex;
  const hoods = new Map<string, NeighborhoodSummary[]>();
  const names: PlaceIndex["names"] = [];
  for (const hood of getNeighborhoods().values()) {
    const key = normalizePlace(hood.name);
    if (!key) continue;
    hoods.set(key, [...(hoods.get(key) ?? []), hood]);
    names.push({ key, hood });
  }
  const districts = new Map<string, string>();
  for (const d of DISTRICTS) {
    const key = normalizePlace(d.name);
    districts.set(key, d.name);
    names.push({ key, district: d.name });
  }
  // Longest names first, so "овча купел 2" wins over "овча купел".
  names.sort((a, b) => b.key.length - a.key.length);
  return (placeIndex = { hoods, districts, names });
}

let districtRecords: Map<string, { act16: Record[]; permits: Record[] }> | null = null;

function getDistrictRecords(name: string): { act16: Record[]; permits: Record[] } {
  if (!districtRecords) {
    districtRecords = new Map();
    for (const reg of REGISTERS) {
      for (const record of getRecords(reg)) {
        if (!record.region) continue;
        let bucket = districtRecords.get(record.region);
        if (!bucket) districtRecords.set(record.region, (bucket = { act16: [], permits: [] }));
        bucket[reg].push(record);
      }
    }
  }
  return districtRecords.get(name) ?? { act16: [], permits: [] };
}

// ---------- Areas (neighbourhoods and districts) ----------

interface Area {
  name: string;
  hoods: NeighborhoodSummary[];
  district: string | null;
  /** Documents summarised for the area (the neighbourhoods if any, else the district). */
  records: { act16: Record[]; permits: Record[] };
}

const hasPage = (h: NeighborhoodSummary) => h.total >= NEIGHBORHOOD_PAGE_MIN_DOCS;
/** Below this, a district of the same name („Изгрев“) describes the area better than its thin neighbourhood. */
const DISTRICT_OVER_HOOD = 20;

/** Resolves a neighbourhood, a family of neighbourhoods („Младост“ → Младост 1–4) or a district. */
export function resolveArea(raw: string): Area | null {
  const key = normalizePlace(raw);
  if (key.length < 2) return null;
  const index = getPlaceIndex();
  let district = index.districts.get(key) ?? null;
  let hoods = [...(index.hoods.get(key) ?? [])];
  for (const { key: name, hood } of index.names) {
    if (hood && name.startsWith(`${key} `) && DIRECTION_SUFFIX.test(name.slice(key.length + 1))) hoods.push(hood);
  }
  if (!hoods.length && !district) {
    const named = neighborhoodFromText(raw);
    const hood = named ? getNeighborhoods().get(named.slug) : undefined;
    if (hood) hoods = [hood];
  }
  if (!hoods.length && !district) {
    // A longer string such as "Овча купел 1, Овча купел": the longest known name it contains.
    const padded = ` ${key} `;
    const found = index.names.find((n) => n.key.length >= 4 && padded.includes(` ${n.key} `));
    if (found?.hood) hoods = [found.hood];
    else if (found?.district) district = found.district;
  }
  if (!hoods.length && !district) return null;

  hoods = [...new Set(hoods)].sort((a, b) => b.total - a.total);
  const hoodTotal = hoods.reduce((sum, h) => sum + h.total, 0);
  // A district wins over a thin neighbourhood of the same name.
  if (hoods.length && (!district || hoodTotal >= DISTRICT_OVER_HOOD)) {
    const exact = hoods.find((h) => normalizePlace(h.name) === key);
    const name =
      hoods.length === 1
        ? neighborhoodLabel(hoods[0])
        : exact?.name ?? district ?? hoods[0].name.replace(/\s*[-–]?\s*(\d+|запад|изток|север|юг)$/i, "");
    return {
      name,
      hoods,
      district,
      records: { act16: hoods.flatMap((h) => h.act16), permits: hoods.flatMap((h) => h.permits) },
    };
  }
  return { name: `район ${district}`, hoods: [], district, records: getDistrictRecords(district!) };
}

function areaTest(area: Area | null): ((e: Entry) => boolean) | null {
  if (!area) return null;
  const slugs = new Set(area.hoods.map((h) => h.slug));
  return (e) => (!!area.district && e.record.region === area.district) || slugs.has(hoodSlugOf(e.record) ?? "");
}

// ---------- Output helpers ----------

// Change of use or splitting flats inside an existing block is filed as "многофамилна сграда" too.
const CHANGE_OF_USE = /(смяна|промяна)\s+(на\s+)?предназначение|разделяне|обединяване/iu;
const isNewBuilding = (r: Record) => isNewApartmentBuilding(r) && !CHANGE_OF_USE.test(r.object);

const docUrl = (reg: RegisterId, r: Record) => `${SITE}/register/${reg}/${recordSlug(r)}/`;
const docRef = (reg: RegisterId, r: Record): LookupDocRef => ({ number: r.number, date: r.date, url: docUrl(reg, r) });
const docOut = (reg: RegisterId, r: Record): LookupDoc => ({
  register: reg,
  number: r.number,
  date: r.date,
  title: truncate(readableCase(r.object), TITLE_LENGTH),
  url: docUrl(reg, r),
});

function cutoffKey(now: Date, months: number): number {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function summarize(area: Area, now: Date): LookupNeighborhood {
  const since = cutoffKey(now, NEW_BUILDING_MONTHS);
  const newBuildings = area.records.act16
    .filter((r) => dateKey(r.date) >= since && isNewBuilding(r))
    .sort((a, b) => dateKey(b.date) - dateKey(a.date))
    .slice(0, MAX_NEW_BUILDINGS)
    .map((r) => {
      const { register: _register, ...doc } = docOut("act16", r);
      return doc;
    });
  const paged = area.hoods.filter(hasPage);
  const url = paged.length
    ? `${SITE}/neighborhood/${paged[0].slug}/`
    : area.district && !area.hoods.length
      ? `${SITE}/region/${slugifyRegion(area.district)}/`
      : null;
  const region = area.hoods.length ? area.hoods[0].regions[0]?.[0] ?? null : area.district;
  const out: LookupNeighborhood = {
    name: area.name,
    region,
    url,
    act16: area.records.act16.length,
    permits: area.records.permits.length,
    newBuildings,
  };
  if (area.hoods.length > 1) {
    out.parts = area.hoods.map((h) => ({
      name: neighborhoodLabel(h),
      url: hasPage(h) ? `${SITE}/neighborhood/${h.slug}/` : null,
      act16: h.act16.length,
      permits: h.permits.length,
    }));
  }
  return out;
}

interface Group {
  id: string | null;
  docs: Array<{ registerId: RegisterId; record: Record }>;
  exact: boolean;
  hasNew: boolean;
  latest: number;
}

function makeGroup(id: string | null, docs: Group["docs"], exact: boolean): Group {
  return {
    id,
    docs,
    exact,
    hasNew: docs.some((d) => isNewBuilding(d.record)),
    latest: docs.reduce((max, d) => Math.max(max, dateKey(d.record.date)), 0),
  };
}

/** Best first: exact cadastral match, then parcels with a new apartment building, then most recent activity. */
function rank(groups: Group[]): Group[] {
  return groups.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.hasNew) - Number(a.hasNew) || b.latest - a.latest);
}

function parcelOut(g: Group): LookupParcel {
  const docs = [...g.docs].sort((a, b) => dateKey(a.record.date) - dateKey(b.record.date));
  const newest = docs[docs.length - 1];
  const latest = (reg: RegisterId) => [...docs].reverse().find((d) => d.registerId === reg);
  const permit = latest("permits");
  const act16 = latest("act16");
  const withHood = [...docs].reverse().map((d) => neighborhoodOf(d.record)).find(Boolean);
  return {
    id: g.id,
    region: newest.record.region,
    neighborhood: withHood ? neighborhoodLabel(withHood) : null,
    permit: permit ? docRef("permits", permit.record) : null,
    act16: act16 ? docRef("act16", act16.record) : null,
    docs: docs.slice(-MAX_DOCS_PER_PARCEL).map((d) => docOut(d.registerId, d.record)),
    docCount: docs.length,
  };
}

/** Groups matched documents by the parcel of their first cadastral id, like /check/, pulling in the parcel's full history. */
function groupByParcel(matched: Entry[]): Group[] {
  const parcels = getParcelGroups();
  const groups = new Map<string, Group>();
  for (const e of matched) {
    const first = idsOf(e.record)[0];
    const id = first ? parcelIdOf(first) : null;
    const key = id ?? `doc:${e.reg}:${recordSlug(e.record)}`;
    if (groups.has(key)) continue;
    const docs = (id && parcels.get(id)) || [{ registerId: e.reg, record: e.record }];
    groups.set(key, makeGroup(id, docs, false));
  }
  return [...groups.values()];
}

// ---------- Matchers ----------

function matchCad(cad: string): { groups: Group[]; matched: number } {
  // Keys are parcels; documents filed under a building or unit id (68134.4082.123.1.15) are folded into theirs.
  const parcels = getParcelGroups();
  const exactKey = cad.split(".").length >= 3 && parcels.has(parcelIdOf(cad)) ? parcelIdOf(cad) : undefined;
  let keys: string[];
  if (exactKey) keys = [exactKey];
  else {
    const all = [...parcels.keys()];
    keys = all.filter((k) => k.startsWith(`${cad}.`));
    if (!keys.length) keys = all.filter((k) => k.startsWith(cad));
  }
  const docs = new Set<Record>();
  const groups = keys.map((k) => {
    const list = parcels.get(k)!;
    for (const d of list) docs.add(d.record);
    return makeGroup(k, list, k === exactKey);
  });
  return { groups, matched: docs.size };
}

function matchStreet(street: string, test: ((e: Entry) => boolean) | null): Entry[] {
  const needle = ` ${street} `;
  const longest = street.split(" ").reduce((a, b) => (b.length > a.length ? b : a));
  const hay = getQueryHay();
  return getEntries().filter((e, i) => hay[i].includes(longest) && scopeWords(e.record).includes(needle) && (!test || test(e)));
}

function matchQuery(terms: string[], test: ((e: Entry) => boolean) | null): Entry[] {
  const hay = getQueryHay();
  return getEntries().filter((e, i) => terms.every((t) => hay[i].includes(t)) && (!test || test(e)));
}

// ---------- Entry point ----------

export function lookup(params: LookupParams, options: { now?: Date } = {}): LookupResult {
  const now = options.now ?? new Date();
  const area = params.hood ? resolveArea(params.hood) : null;
  const test = areaTest(area);
  const query: LookupParams = {};
  let groups: Group[] = [];
  let matched = 0;
  let matchedBy: MatchKind | null = null;

  const qCad = params.q ? normalizeCad(params.q) : null;
  const cad = params.cad ?? qCad;
  if (params.cad) query.cad = params.cad;
  if (cad) {
    const result = matchCad(cad);
    if (result.groups.length) {
      groups = result.groups;
      matched = result.matched;
      matchedBy = "cad";
    }
  }

  const street = params.street ? normalizeStreet(params.street) : "";
  if (params.street) query.street = streetDisplay(params.street) || params.street;
  if (!matchedBy && isStreetName(street)) {
    const found = matchStreet(street, test);
    if (found.length) {
      groups = groupByParcel(found);
      matched = found.length;
      matchedBy = "street";
    }
  }

  if (params.q) query.q = params.q;
  const terms = params.q && !qCad ? queryTerms(params.q) : [];
  if (!matchedBy && terms.length) {
    const found = matchQuery(terms, test);
    if (found.length) {
      groups = groupByParcel(found);
      matched = found.length;
      matchedBy = "q";
    }
  }

  if (params.hood) query.hood = params.hood;
  if (!matchedBy && area && !cad && !street && !terms.length) {
    const inArea = new Set([...area.records.act16, ...area.records.permits]);
    const found = getEntries().filter((e) => inArea.has(e.record));
    groups = groupByParcel(found);
    matched = found.length;
    matchedBy = found.length ? "hood" : null;
  }

  const areaName = area ? (area.hoods.length === 1 ? area.hoods[0].name : area.name.replace(/^район\s+/, "")) : params.hood;
  const checkQuery =
    matchedBy === "cad" ? cad
    : matchedBy === "street" ? query.street
    : matchedBy === "q" ? params.q
    : matchedBy === "hood" ? areaName
    : cad ?? query.street ?? params.q ?? areaName;
  return {
    query,
    matchedBy,
    checkUrl: `${SITE}/check/${checkQuery ? `?q=${encodeURIComponent(checkQuery)}` : ""}`,
    parcels: rank(groups).slice(0, MAX_PARCELS).map(parcelOut),
    neighborhood: area ? summarize(area, now) : null,
    matched,
  };
}
