import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  recordKey,
  extractCadastreIds,
  ekatteOf,
  extractAddress,
  extractLocality,
  parseAddress,
  buildQueries,
  planRecord,
  inSofiaBBox,
  resolvePoint,
  usableHit,
} from "../scripts/geo-lib.mjs";
import {
  USER_AGENT,
  MIN_REQUEST_INTERVAL_MS,
  MAX_RETRIES,
  MAX_CONSECUTIVE_FAILURES,
  parseArgs,
  nominatimUrl,
  interpretResults,
  needsLookup,
  runGeocoder,
  buildPoints,
  serializeCache,
  sortNewestFirst,
  main,
} from "../scripts/geocode.mjs";
import { parseCsv, buildEkatte, serializeEkatte } from "../scripts/build-ekatte.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Real EKATTE values (subset of data/geo/ekatte-sofia.json).
const EKATTE = {
  _source: "test fixture",
  "00357": { name: "Нови Искър", lat: 42.80743, lng: 23.34872 },
  "02659": { name: "Банкя", lat: 42.7074, lng: 23.14697 },
  "04234": { name: "Бистрица", lat: 42.5841, lng: 23.3596 },
  "14831": { name: "Герман", lat: 42.6167, lng: 23.4167 },
  "29150": { name: "Железница", lat: 42.5333, lng: 23.3667 },
  "32216": { name: "Иваняне", lat: 42.70537, lng: 23.18087 },
  "44063": { name: "Лозен", lat: 42.60166, lng: 23.48271 },
  "55419": { name: "Панчарево", lat: 42.59367, lng: 23.41022 },
  "68134": { name: "София", lat: 42.69784, lng: 23.32167 },
};

// Real `scope` values copied from data/permits.json and data/certificates.json.
const S = {
  kutlovitsa:
    'Местност: "ПОДУЕНЕ - РЕДУТА", Квартал по регулация: 195, УПИ: V-149,150,151, Идентификатор КККР (имот): 68134.702.9832, Адрес: ул. “Кутловица”',
  bunkera:
    "Местност: ВИЛНА ЗОНА БУНКЕРА, Квартал по регулация: 3, УПИ: II-104, Идентификатор КККР (имот): 04234.6907.1693",
  denkoglu:
    'Местност: ИПРЗ НА М."ЗОНИ Г - ЦЕНТЪРА"(ЧАСТ), Квартал по регулация: 401, УПИ: I - 82, Идентификатор КККР (имот): 68134.101.82, Планоснимачен район: Централна градска част - район Средец, Планоснимачен № 7, Адрес: ул. Иван Денкоглу № 40, кв. Център',
  manastirski:
    'Местност: М. "МАНАСТИРСКИ ЛИВАДИ - ЗАПАД", Квартал по регулация: 56, УПИ: I - 396, Идентификатор КККР (имот): 68134.1932.2233, Идентификатор КККР (сграда/СОС): 68134.1932.2233.1, Адрес: гр. София, ул. Бяла акация № 2, кв. Манастирски ливади',
  lozen:
    "Местност: с. Лозен, Квартал по регулация: 2, УПИ: XXIII - 3717,3718, Идентификатор КККР (имот): 44063.6230.4918, Адрес: с. Лозен, ул. Блазна № 13",
  kurilo:
    "Местност: ГР. НОВИ ИСКЪР, КВ. КУРИЛО, Квартал по регулация: 51, УПИ: XXXIII - 392, Идентификатор КККР (имот): 00357.5348.146, Адрес: гр. Нови Искър, ул. Иглика № 14, кв. Курило",
  iztokTypo:
    'Местност: "ИЗТОК-ИЗТОК 1 И 2 ЧАСТ", Квартал по регулация: 10, УПИ: XI - 216, Идентификатор КККР (имот): 68134,801.216, Планоснимачен район: кв. Изток, Планоснимачен № 216, Адрес: гр. София, ул. Акад. Методи Попов № 9, кв. ж.к. Изток',
  geoMilev:
    "Местност: “ГЕО МИЛЕВ – ПОДУЕНЕ – РЕДУТА”, Квартал по регулация: 26в, УПИ: V-786, Идентификатор КККР (имот): 68134.702.1786, Идентификатор КККР (сграда/СОС): 68134.702.1786.1, Адрес: ул. “Попова шапка” №  44Б",
  bogrovski:
    'Местност: ПРЗ НА М."БОГРОВСКИ ПЕСОЦИ",КВ.2, Квартал по регулация: 2, УПИ: I - 37, Идентификатор КККР (имот): 68134.8421.41',
  ggcZone:
    "Местност: ГЛАВЕН ГРАДСКИ ЦЕНТЪР-ЗОНА В 17, Квартал по регулация: 12, УПИ: I, Идентификатор КККР (имот): 68134.513.117, Идентификатор КККР (сграда/СОС): 68134.513.117.7 и 68134.513.117.23, Адрес: гр. София, ул. Опълченска № 112А, кв. ж.к. Банишора",
  lyulinBlock:
    'Местност: ж.к."Люлин - 10 мр", Квартал по регулация: 30л, УПИ: III, Идентификатор КККР (имот): 68134.4359.210, Идентификатор КККР (сграда/СОС): 68134.4359.210.11, Адрес: гр. София, кв. ж.к. "Люлин", бл. 136',
  mladostLatinK:
    "Местност: Ж.K. МЛАДОСТ-2, Квартал по регулация: 5, УПИ: VIII-541, Идентификатор КККР (имот): 68134.4091.541",
  lyubotran:
    'Местност: М. "ЛОЗЕНЕЦ І ЧАСТ", Квартал по регулация: 279, УПИ: I, Идентификатор КККР (сграда/СОС): 68134.900.901.1, Планоснимачен район: Кв. Горни Лозенец 2-ри етап, Планоснимачен № 331, Адрес: гр. София, ул. Люботрън № бл.30, вх.А, кв. м. Лозенец',
  knyazSquare:
    'Местност: "ЦЕНТЪРА ЗОНА А-СЕВЕР", Квартал по регулация: 507, УПИ: І, Идентификатор КККР (имот): 68134.405.3, Идентификатор КККР (сграда/СОС): 68134.405.3.1, Планоснимачен район: Централна градска част - район Оборище, Адрес: гр. София, ул. пл. "Княз Александър I"  № 1, кв. Център',
  gorublyane: "Местност: КВ. ГОРУБЛЯНЕ, Квартал по регулация: 94, УПИ: XIV - 78, Идентификатор КККР (имот): 68134.4085.9767",
  gardova:
    "Местност: '' ГЪРДОВА ГЛАВА '', Квартал по регулация: 19, УПИ: III-966, Идентификатор КККР (имот): 68134.1935.1306, Идентификатор КККР (сграда/СОС): 68134.1935.1306.1.2, Адрес: гр. София, ул. \"Иван Багрянов\"  № 28, ет. 1, ап. 2",
  pancharevo: "Местност: С.ПАНЧАРЕВО, Квартал по регулация: 7, УПИ: IV - 538 , Идентификатор КККР (имот): 55419..6707.902",
  tsarSimeon:
    'Местност: "ГГЦ ЗОНА Г-14", Квартал по регулация: 18, УПИ: I - 5, Идентификатор КККР (имот): 68134.401.274, Адрес: гр. София, ул. Цар Симеон 53',
  bankyaIvanyane:
    'Местност: ГР. БАНКЯ, КВ. ИЗГРЕВ, Квартал по регулация: 40, УПИ: I - 354, Идентификатор КККР (имот): 32216.2292.354, Планоснимачен район: Гр. Банкя - кв. Изгрев, Планоснимачен № 20, Адрес: гр. Банкя, ул. "Чавдарица" № 4, кв. кв. Изгрев',
  bankyaLatinA: "Местност: БAНКЯ, Квартал по регулация: 56, УПИ: IV-345, Идентификатор КККР (имот): 02659.2195.345",
  zheleznitsa: "Местност: С. ЖЕЛЕЗНИЦА, Идентификатор КККР (имот): 2915.7110.1330",
  lyulinPr:
    'Местност: ПР ЗА М."ЛЮЛИН-РАЗШИРЕНИЕ-ЗАПАД", КВ.14Б, Квартал по регулация: 14Б, УПИ: III - 9001, Идентификатор КККР (имот): 68134.4363.9003, Адрес: ул. Околовръстен път № 774',
  numberedStreet:
    'Местност: "НПЗ ОРИОН И СЪСЕДНИ ЖИЛИЩНИ ТЕРИТОРИИ", Квартал по регулация: 79, УПИ: IX - 374, Идентификатор КККР (имот): 68134.2824.3628, Адрес: гр. София, ул. 357 № 26, кв. Модерно предградие',
  germanTerraces: 'Местност: "ТЕРАСИТЕ - с. Герман", Идентификатор КККР (имот): 14831.6507.259, Адрес: с. Герман',
  onlySofia: "Квартал по регулация: 118, УПИ: VI - 957 \"за жс\", Идентификатор КККР (имот): 68134.4334.9782, Адрес: гр. София",
};

const rec = (scope, number = "1", date = "01.01.2026") => ({ number, date, scope });

// ---------------------------------------------------------------------------

describe("recordKey", () => {
  it("matches the site-wide key format", () => {
    expect(recordKey("permits", { number: "21", date: "29.09.2026" })).toBe("permits:21-29092026");
    expect(recordKey("act16", { number: "1126", date: "13.10.2026" })).toBe("act16:1126-13102026");
  });
});

describe("extractCadastreIds / ekatteOf", () => {
  it("extracts property and building ids in order", () => {
    expect(extractCadastreIds(S.kutlovitsa)).toEqual(["68134.702.9832"]);
    expect(extractCadastreIds(S.geoMilev)).toEqual(["68134.702.1786", "68134.702.1786.1"]);
    expect(extractCadastreIds(S.ggcZone)).toEqual(["68134.513.117", "68134.513.117.7", "68134.513.117.23"]);
  });

  it("repairs common separator typos and ignores broken ids", () => {
    expect(extractCadastreIds(S.iztokTypo)).toEqual(["68134.801.216"]);
    expect(extractCadastreIds(S.pancharevo)).toEqual(["55419.6707.902"]);
    expect(extractCadastreIds(S.zheleznitsa)).toEqual([]);
    expect(extractCadastreIds("")).toEqual([]);
    expect(extractCadastreIds(undefined)).toEqual([]);
  });

  it("does not read numbers from other fields (УПИ)", () => {
    expect(
      extractCadastreIds("Квартал по регулация: 1, УПИ: XLVII - 6112.1984,6112.1988, Идентификатор КККР (имот): 07106.6112.2175"),
    ).toEqual(["07106.6112.2175"]);
  });

  it("returns the EKATTE code", () => {
    expect(ekatteOf("68134.702.9832")).toBe("68134");
    expect(ekatteOf("04234.6907.1693")).toBe("04234");
    expect(ekatteOf("2915.7110.1330")).toBeNull();
    expect(ekatteOf(null)).toBeNull();
  });
});

describe("extractAddress", () => {
  it.each([
    ["kutlovitsa", "ул. Кутловица"],
    ["denkoglu", "ул. Иван Денкоглу 40"],
    ["manastirski", "ул. Бяла акация 2"],
    ["lozen", "ул. Блазна 13"],
    ["kurilo", "ул. Иглика 14"],
    ["iztokTypo", "ул. Акад. Методи Попов 9"],
    ["geoMilev", "ул. Попова шапка 44Б"],
    ["ggcZone", "ул. Опълченска 112А"],
    ["lyubotran", "ул. Люботрън"], // "№ бл.30" is a block, not a house number
    ["knyazSquare", "пл. Княз Александър I 1"],
    ["gardova", "ул. Иван Багрянов 28"],
    ["tsarSimeon", "ул. Цар Симеон 53"],
    ["bankyaIvanyane", "ул. Чавдарица 4"],
    ["lyulinPr", "ул. Околовръстен път 774"],
  ])("%s → %s", (key, expected) => {
    expect(extractAddress(S[key])).toBe(expected);
  });

  it.each([["onlySofia"], ["lyulinBlock"], ["numberedStreet"], ["bunkera"], ["germanTerraces"]])(
    "%s has no geocodable street",
    (key) => {
      expect(extractAddress(S[key])).toBeNull();
    },
  );

  it("normalises case and duplicated street types", () => {
    expect(extractAddress("Адрес: гр. София, ул. НЕОФИТ БОЗВЕЛИ")).toBe("ул. Неофит Бозвели");
    expect(extractAddress("Адрес: ул. иглика  № 14, кв. Курило")).toBe("ул. Иглика 14");
    expect(extractAddress("Адрес: гр. София, ул. ул. Оралица № 24")).toBe("ул. Оралица 24");
    expect(extractAddress('Адрес: гр. София, Бул."Княгиня Мария Луиза" № 30')).toBe("бул. Княгиня Мария Луиза 30");
    expect(extractAddress("Адрес: ул. „Околовръстен път“ № 510-А")).toBe("ул. Околовръстен път 510А");
  });

  it("parses the components", () => {
    expect(parseAddress('гр. София, кв. ж.к. "Люлин", бл. 136')).toEqual({
      settlement: "София",
      street: null,
      number: null,
      block: "136",
      district: "кв. ж. к. Люлин",
    });
  });
});

describe("extractLocality", () => {
  it.each([
    ["manastirski", "Манастирски ливади - запад"],
    ["kutlovitsa", "Подуене - редута"],
    ["bunkera", "Бункера"],
    ["kurilo", "Курило"],
    ["iztokTypo", "Изток - изток 1"],
    ["geoMilev", "Гео милев - подуене - редута"],
    ["bogrovski", "Богровски песоци"], // "ПРЗ НА М."X"" → X
    ["lyulinBlock", "Люлин 10"],
    ["mladostLatinK", "Младост 2"],
    ["lyubotran", "Лозенец"],
    ["gorublyane", "Горубляне"],
    ["gardova", "Гърдова глава"],
    ["lyulinPr", "Люлин - запад"],
    ["germanTerraces", "Терасите"],
    ["denkoglu", "Център"], // Местност is a planning zone → falls back to "кв. Център"
    ["ggcZone", "Банишора"],
  ])("%s → %s", (key, expected) => {
    expect(extractLocality(S[key])).toBe(expected);
  });

  it.each([["pancharevo"], ["lozen"], ["onlySofia"], ["tsarSimeon"], ["zheleznitsa"]])(
    "%s has no locality beyond the settlement itself",
    (key) => {
      expect(extractLocality(S[key])).toBeNull();
    },
  );

  it("fixes Latin look-alike letters", () => {
    expect(extractLocality(S.bankyaLatinA)).toBe("Банкя");
  });
});

describe("buildQueries", () => {
  it("orders address before localities, scoped to Sofia", () => {
    expect(buildQueries(rec(S.kutlovitsa), EKATTE)).toEqual([
      { kind: "address", q: "ул. Кутловица, София, България" },
      { kind: "locality", q: "Подуене - редута, София, България" },
      { kind: "locality", q: "Подуене, София, България" },
    ]);
    expect(buildQueries(rec(S.manastirski), EKATTE)).toEqual([
      { kind: "address", q: "ул. Бяла акация 2, София, България" },
      { kind: "locality", q: "Манастирски ливади - запад, София, България" },
      { kind: "locality", q: "Манастирски ливади, София, България" },
    ]);
  });

  it("uses the village/town name for records outside Sofia city", () => {
    expect(buildQueries(rec(S.lozen), EKATTE)).toEqual([{ kind: "address", q: "ул. Блазна 13, Лозен, България" }]);
    expect(buildQueries(rec(S.kurilo), EKATTE)).toEqual([
      { kind: "address", q: "ул. Иглика 14, Нови Искър, България" },
      { kind: "locality", q: "Курило, Нови Искър, България" },
    ]);
    expect(buildQueries(rec(S.bunkera), EKATTE)).toEqual([{ kind: "locality", q: "Бункера, Бистрица, България" }]);
  });

  it("scopes streets to the town written in the address", () => {
    // Parcel registered under Иваняне, but the street belongs to Банкя.
    const plan = planRecord(rec(S.bankyaIvanyane), EKATTE);
    expect(plan.queries[0]).toEqual({ kind: "address", q: "ул. Чавдарица 4, Банкя, България" });
    expect(plan.placeName).toBe("Банкя");
    expect(plan.settlement.ekatte).toBe("32216");
  });

  it("never sends a query for the settlement itself", () => {
    expect(buildQueries(rec(S.pancharevo), EKATTE)).toEqual([]);
    expect(buildQueries(rec(S.bankyaLatinA), EKATTE)).toEqual([]);
    expect(buildQueries(rec(S.onlySofia), EKATTE)).toEqual([]);
  });

  it("treats former villages inside the city as localities", () => {
    expect(buildQueries(rec(S.gorublyane), EKATTE)).toEqual([{ kind: "locality", q: "Горубляне, София, България" }]);
  });

  it("falls back to the settlement named in the text when there is no EKATTE map", () => {
    expect(buildQueries(rec(S.lozen))).toEqual([{ kind: "address", q: "ул. Блазна 13, Лозен, България" }]);
  });
});

describe("inSofiaBBox", () => {
  it("accepts Sofia and rejects points outside the box", () => {
    expect(inSofiaBBox(42.6977, 23.3219)).toBe(true);
    expect(inSofiaBBox(42.4, 22.9)).toBe(true);
    expect(inSofiaBBox(42.95, 23.7)).toBe(true);
    expect(inSofiaBBox(42.39, 23.3)).toBe(false);
    expect(inSofiaBBox(42.96, 23.3)).toBe(false);
    expect(inSofiaBBox(42.7, 22.89)).toBe(false);
    expect(inSofiaBBox(42.7, 23.71)).toBe(false);
    expect(inSofiaBBox(42.1354, 24.7453)).toBe(false); // Plovdiv
    expect(inSofiaBBox(NaN, 23.3)).toBe(false);
    expect(inSofiaBBox(undefined, undefined)).toBe(false);
  });
});

describe("resolvePoint", () => {
  const at = "2026-10-01T00:00:00.000Z";
  const record = rec(S.kutlovitsa, "21", "29.09.2026");

  it("prefers address > locality and rounds to 5 decimals", () => {
    const entries = {
      "ул. Кутловица, София, България": { lat: 42.7101234, lng: 23.3509876, at },
      "Подуене - редута, София, България": { lat: 42.705, lng: 23.355, at },
    };
    expect(resolvePoint(record, "permits", { version: 1, entries }, EKATTE)).toEqual([42.71012, 23.35099, 1]);

    delete entries["ул. Кутловица, София, България"];
    expect(resolvePoint(record, "permits", { entries }, EKATTE)).toEqual([42.705, 23.355, 2]);

    entries["Подуене - редута, София, България"] = { miss: true, at };
    entries["Подуене, София, България"] = { lat: 42.709, lng: 23.36, at };
    expect(resolvePoint(record, "permits", entries, EKATTE)).toEqual([42.709, 23.36, 2]);
  });

  it("never returns the Sofia city centroid", () => {
    expect(resolvePoint(record, "permits", { entries: {} }, EKATTE)).toBeNull();
    expect(resolvePoint(rec(S.onlySofia), "permits", { entries: {} }, EKATTE)).toBeNull();
  });

  it("falls back to the village centre (precision 3)", () => {
    expect(resolvePoint(rec(S.bunkera), "act16", { entries: {} }, EKATTE)).toEqual([42.5841, 23.3596, 3]);
    expect(resolvePoint(rec(S.zheleznitsa), "permits", { entries: {} }, EKATTE)).toEqual([42.5333, 23.3667, 3]);
    const entries = { "Бункера, Бистрица, България": { lat: 42.5902, lng: 23.3401, at } };
    expect(resolvePoint(rec(S.bunkera), "act16", { entries }, EKATTE)).toEqual([42.5902, 23.3401, 2]);
  });

  it("ignores hits outside the bbox or far from the village", () => {
    const outside = { "ул. Кутловица, София, България": { lat: 43.2, lng: 23.3, at } };
    expect(resolvePoint(record, "permits", { entries: outside }, EKATTE)).toBeNull();

    // A street of the same name in central Sofia is not in Лозен.
    const far = { "ул. Блазна 13, Лозен, България": { lat: 42.6977, lng: 23.3219, at } };
    expect(resolvePoint(rec(S.lozen), "permits", { entries: far }, EKATTE)).toEqual([42.60166, 23.48271, 3]);
    const near = { "ул. Блазна 13, Лозен, България": { lat: 42.6051, lng: 23.4789, at } };
    expect(resolvePoint(rec(S.lozen), "permits", { entries: near }, EKATTE)).toEqual([42.6051, 23.4789, 1]);
  });

  it("usableHit rejects misses and bad coordinates", () => {
    expect(usableHit({ miss: true, at })).toBe(false);
    expect(usableHit({ lat: "x", lng: 23.3, at })).toBe(false);
    expect(usableHit(undefined)).toBe(false);
    expect(usableHit({ lat: 42.7, lng: 23.3, at })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-10-16T08:00:00.000Z");

function harness({ respond, latencyMs = 150, start = T0 } = {}) {
  let t = start;
  const calls = [];
  const sleeps = [];
  const now = () => t;
  const sleep = async (ms) => {
    sleeps.push(ms);
    t += ms;
  };
  const fetchImpl = vi.fn(async (url, init) => {
    const q = new URL(url).searchParams.get("q");
    calls.push({ url, q, t, headers: init?.headers });
    t += latencyMs;
    return respond(q, calls.length);
  });
  return { now, sleep, fetchImpl, calls, sleeps };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const hit = (lat, lng, place_rank = 30) => json([{ lat: String(lat), lon: String(lng), place_rank }]);

const items = (...scopes) =>
  scopes.map((scope, i) => ({ registerId: "permits", record: rec(scope, String(i + 1), "01.10.2026") }));

describe("parseArgs", () => {
  it("parses flags with defaults", () => {
    expect(parseArgs([])).toEqual({ limit: 400, maxMinutes: 8, network: true, help: false });
    expect(parseArgs(["--limit", "3000", "--max-minutes=45", "--no-network"])).toEqual({
      limit: 3000,
      maxMinutes: 45,
      network: false,
      help: false,
    });
    expect(() => parseArgs(["--limit", "-1"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});

describe("nominatimUrl / interpretResults", () => {
  it("builds the bounded, Bulgaria-only search URL", () => {
    expect(nominatimUrl("ул. Кутловица, София, България")).toBe(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=bg&accept-language=bg" +
        "&viewbox=22.90,42.95,23.70,42.40&bounded=1&q=" +
        encodeURIComponent("ул. Кутловица, София, България"),
    );
  });

  it("filters by bbox and by place rank", () => {
    expect(interpretResults([], "address")).toMatchObject({ status: "miss" });
    expect(interpretResults([{ lat: "42.7", lon: "23.3", place_rank: 30 }], "address")).toEqual({
      status: "hit",
      lat: 42.7,
      lng: 23.3,
    });
    expect(interpretResults([{ lat: "42.14", lon: "24.75", place_rank: 30 }], "address")).toMatchObject({
      status: "miss",
      reason: "outside Sofia bbox",
    });
    // An address query that only matched a suburb is not an address.
    expect(interpretResults([{ lat: "42.7", lon: "23.3", place_rank: 20 }], "address")).toMatchObject({ status: "miss" });
    // A locality query that matched the whole city is useless.
    expect(interpretResults([{ lat: "42.7", lon: "23.3", place_rank: 16 }], "locality")).toMatchObject({ status: "miss" });
    expect(interpretResults([{ lat: "42.7", lon: "23.3", place_rank: 20 }], "locality")).toMatchObject({ status: "hit" });
  });
});

describe("needsLookup", () => {
  it("retries misses only after 60 days", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    expect(needsLookup(undefined, now)).toBe(true);
    expect(needsLookup({ lat: 42.7, lng: 23.3, at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
    expect(needsLookup({ miss: true, at: "2026-09-01T00:00:00Z" }, now)).toBe(false);
    expect(needsLookup({ miss: true, at: "2026-08-16T00:00:00Z" }, now)).toBe(true);
    expect(needsLookup({ miss: true, at: "garbage" }, now)).toBe(true);
  });
});

describe("runGeocoder", () => {
  it("sends at most one request per 1.1 s with the identifying User-Agent", async () => {
    const h = harness({ respond: () => hit(42.71, 23.35) });
    const cache = { version: 1, entries: {} };
    const stats = await runGeocoder({
      items: items(S.kutlovitsa, S.manastirski, S.denkoglu, S.gardova),
      cache,
      ekatte: EKATTE,
      fetchImpl: h.fetchImpl,
      sleep: h.sleep,
      now: h.now,
    });

    expect(stats).toMatchObject({ attempted: 4, hit: 4, miss: 0, error: 0 });
    expect(h.calls).toHaveLength(4);
    for (let i = 1; i < h.calls.length; i++) {
      expect(h.calls[i].t - h.calls[i - 1].t).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS);
    }
    expect(h.sleeps).toEqual([1100, 1100, 1100]);
    for (const call of h.calls) {
      expect(call.headers["User-Agent"]).toBe(USER_AGENT);
      expect(call.url.startsWith("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=bg")).toBe(true);
      expect(call.url).toContain("&viewbox=22.90,42.95,23.70,42.40&bounded=1&q=");
    }
    // Only the address queries were needed: every record resolved on its first query.
    expect(h.calls.map((c) => c.q)).toEqual([
      "ул. Кутловица, София, България",
      "ул. Бяла акация 2, София, България",
      "ул. Иван Денкоглу 40, София, България",
      "ул. Иван Багрянов 28, София, България",
    ]);
    expect(cache.entries["ул. Кутловица, София, България"]).toEqual({
      lat: 42.71,
      lng: 23.35,
      at: new Date(T0 + 150).toISOString(),
    });
  });

  it("falls through to locality queries when the address misses, and stores misses", async () => {
    const h = harness({
      respond: (q) => (q.startsWith("ул.") ? json([]) : q.startsWith("Подуене - редута") ? json([]) : hit(42.709, 23.36, 20)),
    });
    const cache = { version: 1, entries: {} };
    const stats = await runGeocoder({
      items: items(S.kutlovitsa),
      cache,
      ekatte: EKATTE,
      fetchImpl: h.fetchImpl,
      sleep: h.sleep,
      now: h.now,
    });
    expect(stats).toMatchObject({ attempted: 3, hit: 1, miss: 2 });
    expect(cache.entries["ул. Кутловица, София, България"]).toEqual({ miss: true, at: expect.any(String) });
    expect(cache.entries["Подуене, София, България"]).toMatchObject({ lat: 42.709, lng: 23.36 });
    expect(resolvePoint(rec(S.kutlovitsa), "permits", cache, EKATTE)).toEqual([42.709, 23.36, 2]);
  });

  it("stores out-of-bbox results as misses", async () => {
    const h = harness({ respond: () => hit(42.1354, 24.7453) });
    const cache = { version: 1, entries: {} };
    await runGeocoder({ items: items(S.lozen), cache, ekatte: EKATTE, fetchImpl: h.fetchImpl, sleep: h.sleep, now: h.now });
    expect(cache.entries["ул. Блазна 13, Лозен, България"]).toEqual({ miss: true, at: expect.any(String) });
  });

  it("skips cached hits and fresh misses, retries stale misses", async () => {
    const h = harness({ respond: () => hit(42.6051, 23.4789) });
    const fresh = new Date(T0 - 10 * 86400e3).toISOString();
    const stale = new Date(T0 - 61 * 86400e3).toISOString();
    const cache = {
      version: 1,
      entries: {
        "ул. Кутловица, София, България": { lat: 42.71, lng: 23.35, at: fresh },
        "ул. Бяла акация 2, София, България": { miss: true, at: fresh },
        "Манастирски ливади - запад, София, България": { miss: true, at: fresh },
        "Манастирски ливади, София, България": { lat: 42.67, lng: 23.29, at: fresh },
        "ул. Блазна 13, Лозен, България": { miss: true, at: stale },
      },
    };
    const stats = await runGeocoder({
      items: items(S.kutlovitsa, S.manastirski, S.lozen),
      cache,
      ekatte: EKATTE,
      fetchImpl: h.fetchImpl,
      sleep: h.sleep,
      now: h.now,
    });
    expect(h.calls.map((c) => c.q)).toEqual(["ул. Блазна 13, Лозен, България"]);
    expect(stats).toMatchObject({ attempted: 1, hit: 1 });
    expect(cache.entries["ул. Блазна 13, Лозен, България"]).toMatchObject({ lat: 42.6051, lng: 23.4789 });
  });

  it("respects --limit and --max-minutes", async () => {
    const all = items(S.kutlovitsa, S.manastirski, S.denkoglu, S.gardova, S.lozen);

    const h1 = harness({ respond: () => hit(42.71, 23.35) });
    const s1 = await runGeocoder({ items: all, cache: { entries: {} }, ekatte: EKATTE, limit: 2, ...pick(h1) });
    expect(h1.calls).toHaveLength(2);
    expect(s1.stopReason).toMatch(/limit/);

    // Each request takes 25 s → only 3 fit in one minute (0, 26.1, 52.2 s).
    const h2 = harness({ respond: () => hit(42.71, 23.35), latencyMs: 25_000 });
    const s2 = await runGeocoder({ items: all, cache: { entries: {} }, ekatte: EKATTE, maxMinutes: 1, ...pick(h2) });
    expect(h2.calls).toHaveLength(3);
    expect(s2.stopReason).toMatch(/time/);

    const h3 = harness({ respond: () => hit(42.71, 23.35) });
    await runGeocoder({ items: all, cache: { entries: {} }, ekatte: EKATTE, limit: 0, ...pick(h3) });
    expect(h3.calls).toHaveLength(0);
  });

  it("backs off exponentially on 429/5xx and honours Retry-After", async () => {
    const h = harness({
      respond: (q, n) => (n === 1 ? json({}, 429) : n === 2 ? json({}, 503) : n === 3 ? json({}, 429, { "retry-after": "5" }) : hit(42.71, 23.35)),
    });
    const cache = { entries: {} };
    const stats = await runGeocoder({ items: items(S.kutlovitsa), cache, ekatte: EKATTE, ...pick(h) });
    expect(stats).toMatchObject({ attempted: 1, hit: 1, error: 0 });
    expect(h.sleeps).toEqual([2000, 4000, 5000]);
    expect(cache.entries["ул. Кутловица, София, България"]).toMatchObject({ lat: 42.71 });
  });

  it("stops gracefully after repeated failures without caching them", async () => {
    const h = harness({ respond: () => json({}, 503) });
    const cache = { entries: {} };
    const stats = await runGeocoder({
      items: items(S.kutlovitsa, S.manastirski, S.denkoglu, S.gardova),
      cache,
      ekatte: EKATTE,
      ...pick(h),
    });
    expect(stats.error).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(stats.stopReason).toMatch(/consecutive failures/);
    expect(h.calls).toHaveLength(MAX_CONSECUTIVE_FAILURES * (MAX_RETRIES + 1));
    expect(cache.entries).toEqual({});
  });

  it("stops immediately when Nominatim refuses access", async () => {
    const h = harness({ respond: () => json({}, 403) });
    const stats = await runGeocoder({ items: items(S.kutlovitsa, S.manastirski), cache: { entries: {} }, ekatte: EKATTE, ...pick(h) });
    expect(h.calls).toHaveLength(1);
    expect(stats.stopReason).toMatch(/403/);
  });

  it("survives network errors", async () => {
    let n = 0;
    const h = harness({ respond: () => hit(42.71, 23.35) });
    const flaky = vi.fn(async (url, init) => {
      if (++n === 1) throw new TypeError("fetch failed");
      return h.fetchImpl(url, init);
    });
    const cache = { entries: {} };
    const stats = await runGeocoder({ items: items(S.kutlovitsa), cache, ekatte: EKATTE, fetchImpl: flaky, sleep: h.sleep, now: h.now });
    expect(stats).toMatchObject({ hit: 1, error: 0 });
    expect(h.sleeps).toEqual([2000]);
  });
});

function pick(h) {
  return { fetchImpl: h.fetchImpl, sleep: h.sleep, now: h.now };
}

describe("ordering and outputs", () => {
  it("geocodes newest records first", () => {
    const sorted = sortNewestFirst([
      { registerId: "permits", record: { number: "1", date: "05.01.2023" } },
      { registerId: "act16", record: { number: "7", date: "13.10.2026" } },
      { registerId: "permits", record: { number: "9", date: "29.09.2026" } },
    ]);
    expect(sorted.map((x) => x.record.date)).toEqual(["13.10.2026", "29.09.2026", "05.01.2023"]);
  });

  it("serialises the cache with sorted keys, one entry per line", () => {
    const text = serializeCache({
      entries: {
        "б, София, България": { miss: true, at: "2026-10-16T08:00:00.000Z" },
        "а, София, България": { at: "2026-10-16T08:00:00.000Z", lng: 23.3, lat: 42.7 },
      },
    });
    expect(text).toBe(
      '{\n "version": 1,\n "entries": {\n' +
        '  "а, София, България": {"lat":42.7,"lng":23.3,"at":"2026-10-16T08:00:00.000Z"},\n' +
        '  "б, София, България": {"miss":true,"at":"2026-10-16T08:00:00.000Z"}\n' +
        " }\n}\n",
    );
    expect(JSON.parse(text).entries["а, София, България"].lat).toBe(42.7);
    expect(serializeCache({ entries: {} })).toBe('{\n "version": 1,\n "entries": {}\n}\n');
  });

  it("counts precisions", () => {
    const all = [
      { registerId: "permits", record: rec(S.kutlovitsa, "21", "29.09.2026") },
      { registerId: "act16", record: rec(S.bunkera, "1126", "13.10.2026") },
      { registerId: "permits", record: rec(S.onlySofia, "5", "01.10.2026") },
    ];
    const cache = { entries: { "ул. Кутловица, София, България": { lat: 42.71, lng: 23.35, at: "x" } } };
    expect(buildPoints(all, cache, EKATTE)).toEqual({
      counts: { address: 1, locality: 0, settlement: 1, none: 1 },
      points: { "permits:21-29092026": [42.71, 23.35, 1], "act16:1126-13102026": [42.5841, 23.3596, 3] },
    });
  });
});

describe("main (end to end with a temp data dir)", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "akt16-geo-"));
    mkdirSync(join(dir, "geo"));
    writeFileSync(
      join(dir, "permits.json"),
      JSON.stringify({
        permits: [rec(S.kutlovitsa, "21", "29.09.2026"), rec(S.onlySofia, "5", "01.10.2025")],
      }),
    );
    writeFileSync(join(dir, "certificates.json"), JSON.stringify({ certificates: [rec(S.bunkera, "1126", "13.10.2026")] }));
    writeFileSync(join(dir, "geo", "ekatte-sofia.json"), JSON.stringify(EKATTE));
    return dir;
  }
  const read = (dir, f) => JSON.parse(readFileSync(join(dir, "geo", f), "utf8"));

  it("--no-network never fetches and writes settlement points", async () => {
    const dir = setup();
    try {
      const fetchSpy = vi.fn();
      const log = vi.fn();
      const t = { now: () => T0 };
      await main(["--no-network"], { dataDir: dir, fetch: fetchSpy, now: t.now, log });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(readFileSync(join(dir, "geo", "cache.json"), "utf8")).toBe('{\n "version": 1,\n "entries": {}\n}\n');
      const points = read(dir, "points.json");
      expect(points).toEqual({
        version: 1,
        updatedAt: new Date(T0).toISOString(),
        counts: { address: 0, locality: 0, settlement: 1, none: 2 },
        points: { "act16:1126-13102026": [42.5841, 23.3596, 3] },
      });
      expect(log.mock.calls.map((c) => c[0]).join("\n")).toMatch(/settlement 1 \(33\.3%\)/);

      // Unchanged output keeps its timestamp (no noisy daily diffs).
      await main(["--no-network"], { dataDir: dir, now: () => T0 + 86400e3, log });
      expect(read(dir, "points.json").updatedAt).toBe(new Date(T0).toISOString());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("geocodes, writes the cache and the points", async () => {
    const dir = setup();
    try {
      const h = harness({
        respond: (q) => (q.startsWith("ул. Кутловица") ? hit(42.7101234, 23.3509876) : q.startsWith("Бункера") ? hit(42.59, 23.34, 22) : json([])),
      });
      const res = await main(["--limit", "10"], { dataDir: dir, fetch: h.fetchImpl, sleep: h.sleep, now: h.now, log: () => {} });
      // Newest first: the act16 record (13.10.2026) before the permit (29.09.2026).
      expect(h.calls.map((c) => c.q)).toEqual(["Бункера, Бистрица, България", "ул. Кутловица, София, България"]);
      expect(res.stats).toMatchObject({ attempted: 2, hit: 2 });

      const cache = read(dir, "cache.json");
      expect(Object.keys(cache.entries)).toEqual(["ул. Кутловица, София, България", "Бункера, Бистрица, България"].sort());
      expect(cache.entries["ул. Кутловица, София, България"]).toEqual({
        lat: 42.710123,
        lng: 23.350988,
        at: expect.stringMatching(/^2026-10-16T08:00:0\d\.\d{3}Z$/),
      });
      const points = read(dir, "points.json");
      expect(points.counts).toEqual({ address: 1, locality: 1, settlement: 0, none: 1 });
      expect(points.points).toEqual({
        "act16:1126-13102026": [42.59, 23.34, 2],
        "permits:21-29092026": [42.71012, 23.35099, 1],
      });
      expect(Object.keys(points.points)).toEqual([...Object.keys(points.points)].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("build-ekatte", () => {
  const CSV =
    '"village","name","ekatte","province","municipality","postal code","municipality code","geo"\n' +
    '"1","Бистрица","04234","София (столица)","Столична","1444","SOF46","23.359599,42.584097"\n' +
    '"0","София","68134","София (столица)","Столична","1000","SOF46","23.32167,42.697839"\n' +
    '"1","Крива бара","39743","Монтана","Брусарци","3669","MON07","23.075925,43.687317"\r\n';

  it("parses quoted CSV and swaps lng,lat", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
    expect(buildEkatte(CSV)).toEqual({
      "04234": { name: "Бистрица", lat: 42.5841, lng: 23.3596 },
      68134: { name: "София", lat: 42.69784, lng: 23.32167 },
    });
    expect(() => buildEkatte(CSV.replace("68134", "68135"))).toThrow(/68134/);
    const text = serializeEkatte(buildEkatte(CSV));
    expect(JSON.parse(text)._source).toContain("settlements_loc.csv");
  });

  it("the committed file covers Sofia municipality", () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, "..", "data", "geo", "ekatte-sofia.json"), "utf8"));
    const codes = Object.keys(file).filter((k) => k !== "_source");
    expect(file._source).toContain("raw.githubusercontent.com/yurukov/Bulgaria-geocoding");
    expect(codes.length).toBeGreaterThanOrEqual(38);
    expect(file["68134"].name).toBe("София");
    expect(file["04234"]).toEqual({ name: "Бистрица", lat: 42.5841, lng: 23.3596 });
    for (const code of codes) expect(inSofiaBBox(file[code].lat, file[code].lng)).toBe(true);
  });
});
