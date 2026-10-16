/**
 * Pure helpers for the akt16.org geocoding pipeline.
 *
 * No I/O lives here: everything is deterministic so it can be unit-tested and
 * shared by scripts/geocode.mjs. The NAG `scope` field looks like
 *
 *   Местност: "ПОДУЕНЕ - РЕДУТА", Квартал по регулация: 195, УПИ: V-149,150,151,
 *   Идентификатор КККР (имот): 68134.702.9832, Адрес: ул. “Кутловица”
 *
 * Values are free text typed by many different clerks, so the normalisers
 * below are deliberately forgiving and err on the side of "no query" rather
 * than sending garbage to Nominatim.
 */

export const SOFIA_EKATTE = "68134";
export const SOFIA_NAME = "София";
export const COUNTRY_NAME = "България";

/** Rough bounding box of Sofia municipality (Столична община). */
export const SOFIA_BBOX = Object.freeze({ minLat: 42.4, maxLat: 42.95, minLng: 22.9, maxLng: 23.7 });

/** Third element of a point tuple: lower is more precise. */
export const PRECISION = Object.freeze({ address: 1, locality: 2, settlement: 3 });
export const PRECISION_NAMES = Object.freeze({ 1: "address", 2: "locality", 3: "settlement" });

/**
 * For records inside a village/town (EKATTE ≠ 68134) a geocoded hit farther
 * than this from the settlement centre is treated as a false positive (e.g. a
 * street with the same name somewhere else in Sofia).
 */
export const MAX_SETTLEMENT_DISTANCE_KM = 8;

const MAX_LOCALITY_QUERIES = 3;

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** `${registerId}:${number}-${date without dots}`, e.g. `permits:21-29092026`. */
export function recordKey(registerId, record) {
  return `${registerId}:${record?.number ?? ""}-${String(record?.date ?? "").replace(/\./g, "")}`;
}

export function inSofiaBBox(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SOFIA_BBOX.minLat &&
    lat <= SOFIA_BBOX.maxLat &&
    lng >= SOFIA_BBOX.minLng &&
    lng <= SOFIA_BBOX.maxLng
  );
}

export function roundCoord(value, decimals = 5) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const QUOTES_RE = /["'`„“”«»‘’‚‛]/g;
// Latin look-alikes typed inside Cyrillic words ("БAНКЯ", "Ж.K."). X/I/V are
// left alone so roman numerals such as "XI" or "IV-ТА" survive.
const LATIN_LOOKALIKES = {
  A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", Y: "У",
  a: "а", c: "с", e: "е", o: "о", p: "р", y: "у",
};

function fixMixedScript(word) {
  if (!/[A-Za-z]/.test(word)) return word;
  // Mixed words ("БAНКЯ") and short Latin abbreviations ("M." for "М.").
  const mixed = /[\u0400-\u04FF]/.test(word);
  if (!mixed && !/^[ABCEHKMOPTYaceopy]{1,2}\.$/.test(word)) return word;
  return word.replace(/[ABCEHKMOPTYaceopy]/g, (ch) => LATIN_LOOKALIKES[ch]);
}

/**
 * Removes every kind of quote, unifies dashes, turns line breaks/semicolons
 * into commas, fixes Latin look-alikes inside Cyrillic words, separates glued
 * abbreviations ("ул.Оралица" → "ул. Оралица") and collapses whitespace.
 */
export function cleanText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t;]+/g, ", ")
    .replace(QUOTES_RE, " ")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\S+/g, fixMixedScript)
    .replace(/(\p{L})\.(?=\p{L})/gu, "$1. ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

const isAllUpper = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
const isAllLower = (s) => s === s.toLowerCase() && s !== s.toUpperCase();

/** "НОВИ ИСКЪР" → "Нови Искър"; Latin roman numerals stay upper case. */
export function capitalizeWords(s) {
  return String(s)
    .toLowerCase()
    .split(" ")
    .map((w) => (/^[ivxl]{1,4}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** "МАНАСТИРСКИ ЛИВАДИ - ЗАПАД" → "Манастирски ливади - запад". */
export function sentenceCase(s) {
  const lower = String(s).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Cyrillic letters only: "Iii" or "12-та" do not make a place name. */
const countLetters = (s) => (String(s).match(/[\u0400-\u04FF]/g) || []).length;

// ---------------------------------------------------------------------------
// Scope parsing
// ---------------------------------------------------------------------------

const SCOPE_KEY_SOURCES = [
  "Местност",
  "Квартал по регулация",
  "УПИ",
  "Идентификатор КККР(?:\\s*\\([^)]*\\))?",
  "Планоснимачен район",
  "Адрес",
  "при граници",
  "КВС",
];
const SCOPE_KEY_RE = new RegExp(`(?:^|,)\\s*(${SCOPE_KEY_SOURCES.join("|")})\\s*:`, "g");

/** Splits a scope string into `{ key, value }` parts (values may contain commas). */
export function parseScope(scope) {
  const s = String(scope ?? "");
  const marks = [];
  for (const m of s.matchAll(SCOPE_KEY_RE)) {
    marks.push({ key: m[1].replace(/\s+/g, " "), start: m.index, end: m.index + m[0].length });
  }
  return marks.map((mark, i) => ({
    key: mark.key,
    value: s.slice(mark.end, i + 1 < marks.length ? marks[i + 1].start : s.length).trim(),
  }));
}

/** First value for a scope key, or null. */
export function scopeValue(scope, key) {
  const part = parseScope(scope).find((p) => p.key === key);
  return part && part.value ? part.value : null;
}

// Tolerates the typos seen in the registers: "68134..1386.60", "68134,801.216",
// "68134/4084.346", "68134.4334,9763".
const CADASTRE_ID_RE = /(?<!\d)(\d{5})(?:\.{1,2}|,|\/)(\d{1,5})(?:\.{1,2}|,)(\d{1,6})((?:\.\d{1,6})*)(?!\d)/g;

/** All КККР identifiers (property first, then buildings), normalised to dots. */
export function extractCadastreIds(scope) {
  const ids = [];
  for (const { key, value } of parseScope(scope)) {
    if (!key.startsWith("Идентификатор КККР")) continue;
    for (const m of value.matchAll(CADASTRE_ID_RE)) {
      const id = `${m[1]}.${m[2]}.${m[3]}${m[4] || ""}`;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** "68134.702.9832" → "68134". */
export function ekatteOf(id) {
  const m = /^(\d{5})\./.exec(String(id ?? ""));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const STREET_TYPES = [
  { re: /^(?:ул|улица)(?:\.\s*|\s+)/iu, label: "ул." },
  { re: /^(?:бул|булевард)(?:\.\s*|\s+)/iu, label: "бул." },
  { re: /^(?:пл|площад)(?:\.\s*|\s+)/iu, label: "пл." },
];
const SETTLEMENT_SEGMENT_RE = /^(?:гр\.|гр\s|град\s|с\.|село\s)\s*(.+)$/iu;
const DISTRICT_SEGMENT_RE =
  /^(?:кв\.|кв\s|квартал\s|ж\.\s?[кk](?:\.|(?!\p{L}))|жк\s|м\.|местност\s|в\.\s?з(?:\.|(?!\p{L}))|вилна зона\s)/iu;
const BLOCK_SEGMENT_RE = /^бл\.?\s*(\d+\p{L}?)/iu;
const UNIT_SEGMENT_RE = /^(?:бл|вх|ет|ап)(?:\.|\s|$)/iu;

function normalizeStreet(raw) {
  let rest = String(raw).trim();
  let label = null;
  for (let changed = true; changed; ) {
    changed = false;
    for (const type of STREET_TYPES) {
      const m = type.re.exec(rest);
      if (m) {
        label = type.label; // "ул. пл. Княз Александър I" → the last type wins
        rest = rest.slice(m[0].length).trim();
        changed = true;
      }
    }
  }
  rest = rest.replace(/^[\s.,-]+|[\s.,-]+$/g, "").replace(/\s+/g, " ");
  // Numbered streets ("ул. 357", "ул. 12-та") are too ambiguous for a
  // free-text geocoder.
  if (!/\p{L}{3,}/u.test(rest)) return null;
  if (isAllUpper(rest) || isAllLower(rest)) rest = capitalizeWords(rest);
  return label ? `${label} ${rest}` : rest;
}

function parseHouseNumber(raw) {
  const s = String(raw ?? "").replace(/\s+/g, "");
  const block = /^бл\.?(\d+\p{L}?)/iu.exec(s);
  if (block) return { number: null, block: block[1].toUpperCase() };
  const m = /^(\d{1,4})(?:-?([а-жa-h])(?![\p{L}]))?/iu.exec(s);
  if (!m) return { number: null, block: null };
  return { number: m[1] + (m[2] ? m[2].toUpperCase() : ""), block: null };
}

/**
 * Parses the `Адрес` value into its components:
 * `{ settlement, street, number, block, district }` (all nullable) or null.
 */
export function parseAddress(value) {
  const text = cleanText(value);
  if (!text) return null;
  const out = { settlement: null, street: null, number: null, block: null, district: null };
  for (const segment of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    let m;
    if (!out.settlement && (m = SETTLEMENT_SEGMENT_RE.exec(segment))) {
      out.settlement = capitalizeWords(m[1].split("№")[0].replace(/[\s.,-]+$/, "").trim());
      continue;
    }
    if (DISTRICT_SEGMENT_RE.test(segment)) {
      out.district ??= segment;
      continue;
    }
    if ((m = BLOCK_SEGMENT_RE.exec(segment))) {
      out.block ??= m[1].toUpperCase();
      continue;
    }
    if (UNIT_SEGMENT_RE.test(segment) || out.street) continue;

    const numberAt = segment.indexOf("№");
    let namePart = numberAt >= 0 ? segment.slice(0, numberAt) : segment;
    let numberPart = numberAt >= 0 ? segment.slice(numberAt + 1) : "";
    const hasType = STREET_TYPES.some((t) => t.re.test(namePart.trim()));
    if (!hasType && !(numberAt > 0 && /\p{L}{3,}/u.test(namePart))) continue;
    if (numberAt < 0) {
      // "ул. Цар Симеон 53" (number without "№")
      const tail = /^(.*\p{L}.*?)\s+(\d{1,4}(?:-?[а-жa-h])?)$/iu.exec(namePart.trim());
      if (tail) [namePart, numberPart] = [tail[1], tail[2]];
    }
    const street = normalizeStreet(namePart);
    if (!street) continue;
    out.street = street;
    if (numberPart) {
      const hn = parseHouseNumber(numberPart);
      out.number = hn.number;
      out.block ??= hn.block;
    }
  }
  return out;
}

/**
 * Cleaned street address ("ул. Иван Денкоглу 40") or null when the value has
 * no street (e.g. just "гр. София" or "ж.к. Люлин, бл. 136").
 */
export function extractAddress(scope) {
  const address = parseAddress(scopeValue(scope, "Адрес"));
  if (!address?.street) return null;
  return address.number ? `${address.street} ${address.number}` : address.street;
}

// ---------------------------------------------------------------------------
// Localities (Местност / квартал / вилна зона …)
// ---------------------------------------------------------------------------

// Planning artefacts and descriptions that never name a place.
const LOCALITY_REJECT_RE =
  /(?<!\p{L})(?:упи|ипрз|пуп|прз|ипр|пур|ипур|пи|пр|кадастр\p{L}*|имот\p{L}*|терен\p{L}*|територи\p{L}*|отреден\p{L}*|прилежащ\p{L}*|около|км|километ\p{L}*|зони|градска част|градска територия|главен градски център|ггц|цгч|архитект|общин\p{L}*|пробив|стойност|р-н|район|квартали|между|актове|одобрява\p{L}*)(?!\p{L})/iu;
// "ПРЗ НА М."БОГРОВСКИ ПЕСОЦИ"" → the place is what follows "на м.".
const PLAN_OF_LOCALITY_RE =
  /^(?:.*?(?<!\p{L}))?(?:прз|пр|пуп|ипрз|ипр|пур|ипур)(?!\p{L}).*?(?<!\p{L})(?:на|за)\s+(?:м\.|местност(?!\p{L}))\s*(.+)$/iu;
const STREET_PIECE_RE = /^(?:ул|бул|пл)\.\s/iu;

const LOCALITY_PREFIX_RE = new RegExp(
  "^(?:" +
    [
      "м\\.",
      "мест\\.",
      "местност(?!\\p{L})",
      "кв\\.",
      "квартал(?!\\p{L})",
      "кв(?=\\s)",
      "ж\\.\\s?[кk](?:\\.|(?!\\p{L}))",
      "жк(?!\\p{L})",
      "в\\.\\s?з(?:\\.|(?!\\p{L}))",
      "вз(?!\\p{L})",
      "вилна\\s+зона(?!\\p{L})",
      "(?:нпз|нзп|спз|ипз|пз)(?!\\p{L})",
      "(?:промишлена|индустриална|производствена|складова)\\s+зона(?!\\p{L})",
      "жил\\.?\\s*група(?!\\p{L})",
      "жг(?!\\p{L})",
      "жилищна\\s+(?:група|зона)(?!\\p{L})",
      "жилищен\\s+комплекс(?!\\p{L})",
    ].join("|") +
    ")[\\s.\\-]*",
  "u",
);

const ORDINAL = "(?:\\d+|[ivxlі]+)(?:\\s*-\\s*(?:ва|ра|та|ма|ви|ри|ти|ми|о|и))?";
const PART_RE = new RegExp(
  `(?<!\\p{L})(?:${ORDINAL}\\s*(?:части|част|ч\\.|етап|том)|(?:части|част|етап|том)(?:\\s*${ORDINAL})?)(?!\\p{L})`,
  "gu",
);
const ORDINAL_RE = /(?<![\p{L}\d])\d+\s*-\s*(?:ва|ра|та|ма|ви|ри|ти|ми)(?!\p{L})/gu;
const NOISE_RE =
  /(?<!\p{L})(?:изберете|актуализация|разширение|микрорайон|м\.\s?р\.?|мр|обслужващи обекти(?: на околовръстен път)?)(?!\p{L})/gu;
const KV_NUMBER_RE = /(?<!\p{L})кв\.?\s*\d+\p{L}?/gu;
const ROMAN_DIGITS = { i: "1", ii: "2", iii: "3", iv: "4", і: "1", іі: "2", ііі: "3", іv: "4" };
const GENERIC_LOCALITIES = new Set([
  "зона",
  "зона за отдих",
  "стопански двор",
  "вилна зона",
  "жилищна зона",
  "местност",
  "квартал",
  "група",
  "софия",
  "град софия",
]);

function stripLocalityPrefixes(s) {
  let out = s.trim();
  for (let m = LOCALITY_PREFIX_RE.exec(out); m && m[0]; m = LOCALITY_PREFIX_RE.exec(out)) {
    out = out.slice(m[0].length).trim();
  }
  return out;
}

function normalizeLocalityPart(raw) {
  // "кв. 8 на м. герман" → "м. герман"
  let s = raw.toLowerCase().replace(KV_NUMBER_RE, " ").replace(/^\s*(?:на|от|за)\s+/u, "");
  s = stripLocalityPrefixes(s);
  let settlement = null;

  // Leading settlement reference: "гр. нови искър", "с. герман-терасите".
  let m = /^(?:гр\.|град(?!\p{L})|с\.|село(?!\p{L}))\s*(.+)$/u.exec(s);
  if (m) {
    const [head, ...rest] = m[1].split(/\s*-\s*/);
    settlement = capitalizeWords(head.trim());
    s = stripLocalityPrefixes(rest.join(" - "));
  }
  // Trailing settlement reference: "терасите - с. герман".
  m = /^(.*?)[\s-]+(?:гр\.|с\.)\s*(\p{L}[\p{L} ]*)$/u.exec(s);
  if (m) {
    settlement ??= capitalizeWords(m[2].trim());
    s = m[1];
  }

  s = s
    .replace(KV_NUMBER_RE, " ")
    .replace(PART_RE, " ")
    .replace(ORDINAL_RE, " ")
    .replace(NOISE_RE, " ")
    .replace(/^[ivxlі]+(?:\s*-\s*|\s+)(?=\p{L})/u, "") // "iii-извънградска" → "извънградска"
    .replace(/(?<=(?<!\p{L})\p{L})\s*-\s*(?=\d)/gu, "-") // zone codes: "б- 19" → "б-19"
    .replace(/(?<=\p{L}{2})\s*-\s*(?=\d)/gu, " ") // "люлин-1" → "люлин 1"
    .replace(/(?<=\p{L}{2}|\d|\.)\s*-\s*(?=\p{L}{2})/gu, " - ") // "волуяк-гарата" → "волуяк - гарата" (not "д-р")
    .replace(/(?:\s*-\s*){2,}/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,-]+|[\s.,-]+$/g, "")
    .replace(/^(?:на|от|за)\s+/u, ""); // "разширение на в.з. х" → "в. з. х"
  s = stripLocalityPrefixes(s);
  s = s.replace(/\s([iv]{1,3}|[іv]{1,3})$/u, (all, roman) => (ROMAN_DIGITS[roman] ? ` ${ROMAN_DIGITS[roman]}` : all));
  // Drop street pieces: "бул. сливница - люлин 10" → "люлин 10".
  s = s
    .split(" - ")
    .filter((piece) => !STREET_PIECE_RE.test(piece))
    .join(" - ");

  if (countLetters(s) < 3 || GENERIC_LOCALITIES.has(s)) return { name: null, settlement };
  return { name: sentenceCase(s), settlement };
}

/**
 * Normalises a free-text locality value (Местност, the "кв." part of an
 * address, Планоснимачен район). Returns `{ names, settlement }` where
 * `names` holds the cleaned name and, for "A - B" names, the core "A" as a
 * fallback; `settlement` is a village/town named in the value ("С. ЛОЗЕН").
 */
export function normalizeLocality(value) {
  const result = { names: [], settlement: null };
  const text = cleanText(value)
    .replace(/\([^)]*\)?/g, " ") // "(РАЗШИРЕНИЕ НА КВ. ГОРНА БАНЯ)"
    .replace(/(?<=^|[\s,-])\/[^/]*\//g, " ") // "КВ.1 /НОВ/", "/АМЕРИКАНСКИ КОЛЕЖ/"
    .replace(/(?<!\p{L})м\/у(?!\p{L})/giu, "между")
    .replace(/\//g, ", ");
  if (!text) return result;
  for (let raw of text.split(/\s*,\s*|\s+и\s+/iu)) {
    if (!raw || raw.includes("№") || /планоснимачен/iu.test(raw)) continue;
    const plan = PLAN_OF_LOCALITY_RE.exec(raw);
    if (plan) raw = plan[1];
    if (LOCALITY_REJECT_RE.test(raw)) continue;
    const { name, settlement } = normalizeLocalityPart(raw);
    if (settlement && !result.settlement) result.settlement = settlement;
    if (name && result.names.length === 0) {
      result.names.push(name);
      const core = name.split(" - ")[0].trim();
      if (core !== name && countLetters(core) >= 3 && !GENERIC_LOCALITIES.has(core.toLowerCase())) {
        result.names.push(core);
      }
    }
  }
  return result;
}

const isSofiaName = (name) => String(name ?? "").toLowerCase() === SOFIA_NAME.toLowerCase();

/**
 * Ordered, de-duplicated locality names for a scope. `placeName` (the
 * settlement the queries are scoped to) is never a locality of itself. When
 * the record is inside Sofia city, a former village named in the scope
 * ("С. СЕСЛАВЦИ", "КВ. ГОРУБЛЯНЕ") is a perfectly good locality.
 */
function localityCandidatesFrom(parts, placeName, isSettlementName = () => false) {
  const skip = new Set([SOFIA_NAME, placeName].filter(Boolean).map((s) => s.toLowerCase()));
  const out = [];
  const add = (names) => {
    for (const n of names) {
      const name = sentenceCase(n);
      if (!skip.has(name.toLowerCase()) && !isSettlementName(name) && !out.includes(name)) out.push(name);
    }
  };
  add(parts.locality.names);
  add(parts.district.names);
  if (out.length === 0) add(parts.survey.names);
  if (isSofiaName(placeName) && parts.namedSettlement && !isSofiaName(parts.namedSettlement)) {
    add([parts.namedSettlement]);
  }
  return out.slice(0, MAX_LOCALITY_QUERIES);
}

function analyseScope(scope) {
  const address = parseAddress(scopeValue(scope, "Адрес"));
  const locality = normalizeLocality(scopeValue(scope, "Местност"));
  const district = normalizeLocality(address?.district);
  const survey = normalizeLocality(scopeValue(scope, "Планоснимачен район"));
  const namedSettlement = address?.settlement ?? locality.settlement ?? survey.settlement ?? null;
  return { address, locality, district, survey, namedSettlement };
}

/**
 * Cleaned locality name (Местност first, then the "кв." part of the address,
 * then Планоснимачен район) or null when nothing geocodable is present.
 */
export function extractLocality(scope) {
  return localityCandidatesFrom(analyseScope(scope), null)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Settlements (EKATTE)
// ---------------------------------------------------------------------------

/** EKATTE entry `{ ekatte, name, lat, lng }` or null. */
export function lookupEkatte(ekatte, code) {
  if (!ekatte || !/^\d{5}$/.test(String(code ?? ""))) return null;
  const e = ekatte[code];
  if (!e || !Number.isFinite(e.lat) || !Number.isFinite(e.lng)) return null;
  return { ekatte: code, name: e.name, lat: e.lat, lng: e.lng };
}

const nameIndexCache = new WeakMap();
function findSettlementByName(ekatte, name) {
  if (!ekatte || !name) return null;
  let index = nameIndexCache.get(ekatte);
  if (!index) {
    index = new Map();
    for (const [code, e] of Object.entries(ekatte)) {
      if (/^\d{5}$/.test(code) && e?.name) index.set(e.name.toLowerCase(), code);
    }
    nameIndexCache.set(ekatte, index);
  }
  const code = index.get(String(name).toLowerCase());
  return code ? lookupEkatte(ekatte, code) : null;
}

/**
 * Everything needed to geocode one record:
 * - `queries`: ordered `{ kind, q }` list (address first, then localities)
 * - `placeName`: what the queries are scoped to ("София" or a village/town)
 * - `centre`: centre of that village/town (null inside Sofia city); hits
 *   farther than MAX_SETTLEMENT_DISTANCE_KM from it are ignored
 * - `settlement`: EKATTE entry of the parcel (cadastre id first, else the
 *   settlement named in the text) — the precision-3 fallback when it is not
 *   Sofia city itself
 */
export function planRecord(record, ekatte = null) {
  const scope = String(record?.scope ?? "");
  const parts = analyseScope(scope);
  // A bare village name as Местност ("БАНКЯ", "ДОБРОСЛАВЦИ") names the
  // settlement, not a locality inside it.
  const isSettlementName = (name) => Boolean(findSettlementByName(ekatte, name));
  const namedSettlement = parts.namedSettlement ?? parts.locality.names.find(isSettlementName) ?? null;

  let cadastre = null;
  for (const id of extractCadastreIds(scope)) {
    cadastre = lookupEkatte(ekatte, ekatteOf(id));
    if (cadastre) break;
  }
  const named = findSettlementByName(ekatte, namedSettlement);
  const settlement = cadastre ?? named;
  const outsideCity = (s) => (s && s.ekatte !== SOFIA_EKATTE ? s : null);

  // Streets are addressed by the settlement written in the address
  // ("гр. Банкя, ул. Чавдарица" on a parcel registered under Иваняне), so a
  // known non-Sofia name from the text wins over the cadastre for scoping.
  const centre = outsideCity(named) ?? outsideCity(settlement);
  let placeName = centre?.name ?? SOFIA_NAME;
  if (!centre && !settlement && namedSettlement && !isSofiaName(namedSettlement)) placeName = namedSettlement;
  const suffix = `, ${placeName}, ${COUNTRY_NAME}`;

  const queries = [];
  const push = (kind, text) => {
    const q = `${text}${suffix}`;
    if (!queries.some((x) => x.q === q)) queries.push({ kind, q });
  };
  if (parts.address?.street) {
    const { street, number } = parts.address;
    push("address", number ? `${street} ${number}` : street);
  }
  for (const name of localityCandidatesFrom({ ...parts, namedSettlement }, placeName, isSettlementName)) {
    push("locality", name);
  }

  return { queries, placeName, centre, settlement };
}

/**
 * Ordered candidate Nominatim queries for a record, each scoped to Sofia (or
 * to the village/town for records outside the city):
 *   { kind: "address",  q: "ул. Кутловица, София, България" }
 *   { kind: "locality", q: "Подуене - редута, София, България" }
 */
export function buildQueries(record, ekatte = null) {
  return planRecord(record, ekatte).queries;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** A cache entry that is a hit inside Sofia (and near `centre` when given). */
export function usableHit(entry, centre = null) {
  if (!entry || entry.miss) return false;
  const { lat, lng } = entry;
  if (!inSofiaBBox(lat, lng)) return false;
  if (centre && haversineKm(centre, { lat, lng }) > MAX_SETTLEMENT_DISTANCE_KM) return false;
  return true;
}

/**
 * Best point for a record: `[lat, lng, precision]` or null.
 * Address (1) > locality (2) > settlement centre (3). Records in Sofia city
 * (EKATTE 68134) never get a settlement point — the city centroid is useless.
 * `registerId` is accepted for symmetry with recordKey(); it is not needed.
 * `cache` may be the whole cache file or just its `entries` map.
 */
export function resolvePoint(record, registerId, cache, ekatte = null) {
  const entries = cache?.entries ?? cache ?? {};
  const { queries, centre, settlement } = planRecord(record, ekatte);
  for (const { kind, q } of queries) {
    const entry = entries[q];
    if (usableHit(entry, centre)) return [roundCoord(entry.lat), roundCoord(entry.lng), PRECISION[kind]];
  }
  if (settlement && settlement.ekatte !== SOFIA_EKATTE && inSofiaBBox(settlement.lat, settlement.lng)) {
    return [roundCoord(settlement.lat), roundCoord(settlement.lng), PRECISION.settlement];
  }
  return null;
}
