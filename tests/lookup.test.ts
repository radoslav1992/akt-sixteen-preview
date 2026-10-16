import { describe, expect, it } from "vitest";
import {
  lookup,
  lookupCacheQuery,
  normalizeCad,
  normalizePlace,
  normalizeStreet,
  parseLookupParams,
  queryTerms,
  resolveArea,
  type LookupResult,
} from "../src/lib/lookup";
import { GET, OPTIONS } from "../src/pages/api/lookup";
import { dateKey } from "../src/lib/format";

const NOW = new Date("2026-10-16T12:00:00Z");
const run = (qs: string): LookupResult => {
  const params = parseLookupParams(new URLSearchParams(qs));
  expect(params, qs).not.toBeNull();
  return lookup(params!, { now: NOW });
};

function expectWellFormed(result: LookupResult) {
  expect(result.parcels.length).toBeLessThanOrEqual(8);
  expect(result.checkUrl).toMatch(/^https:\/\/akt16\.org\/check\/(\?q=.+)?$/);
  for (const parcel of result.parcels) {
    expect(parcel.docs.length).toBeGreaterThan(0);
    expect(parcel.docCount).toBeGreaterThanOrEqual(parcel.docs.length);
    const keys = parcel.docs.map((d) => dateKey(d.date));
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    for (const doc of parcel.docs) {
      expect(doc.url).toMatch(/^https:\/\/akt16\.org\/register\/(act16|permits)\/\d+-\d{8}\/$/);
      expect(doc.url).toContain(`/register/${doc.register}/`);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.title.length).toBeLessThanOrEqual(110);
    }
    for (const ref of [parcel.permit, parcel.act16]) if (ref) expect(ref.url).toMatch(/^https:\/\/akt16\.org\/register\//);
  }
  // Compact enough for an extension to fetch on every listing.
  expect(JSON.stringify(result).length).toBeLessThan(20_000);
}

describe("lookup input normalization", () => {
  it("accepts cadastral ids and prefixes, rejects anything else", () => {
    expect(normalizeCad("68134.4082")).toBe("68134.4082");
    expect(normalizeCad(" 68134.4082.123. ")).toBe("68134.4082.123");
    expect(normalizeCad("68134.702.432.1.39")).toBe("68134.702.432.1.39");
    expect(normalizeCad("68134")).toBeNull();
    expect(normalizeCad("abc")).toBeNull();
  });

  it("reduces street names to their words", () => {
    expect(normalizeStreet("ул. Кутловица")).toBe("кутловица");
    expect(normalizeStreet("бул. „Цариградско шосе“ № 115")).toBe("цариградско шосе");
    expect(normalizeStreet("ул. Проф. Велизар Велков 12А")).toBe("велизар велков");
    expect(normalizeStreet("ул.Ралевица, кв. Манастирски ливади")).toBe("ралевица");
  });

  it("normalizes place names and free-text terms", () => {
    expect(normalizePlace("ж.к. Младост 1А")).toBe("младост 1");
    expect(normalizePlace("гр. София, кв. Манастирски ливади")).toBe("манастирски ливади");
    expect(normalizePlace("Манастирски ливади – запад")).toBe("манастирски ливади запад");
    expect(queryTerms("ул. Кутловица, София")).toEqual(["кутловица"]);
  });

  it("treats empty or meaningless input as unusable", () => {
    for (const qs of ["", "q=", "q=%20%20", "q=ул.", "cad=abc", "hood=София", "street=ул.", "other=1"]) {
      expect(parseLookupParams(new URLSearchParams(qs)), qs).toBeNull();
    }
  });

  it("limits every parameter to 120 characters and builds a stable cache key", () => {
    const params = parseLookupParams(new URLSearchParams({ q: "Кутловица ".repeat(40), hood: "Лозенец" }))!;
    expect(params.q!.length).toBeLessThanOrEqual(120);
    expect(lookupCacheQuery({ street: "Кутловица", hood: "Подуяне" })).toBe(lookupCacheQuery({ hood: "Подуяне", street: "Кутловица" }));
  });
});

describe("lookup against the registers", () => {
  it("finds parcels by cadastral prefix", () => {
    const result = run("cad=68134.4082");
    expect(result.matchedBy).toBe("cad");
    expect(result.matched).toBeGreaterThan(0);
    expect(result.parcels.length).toBeGreaterThan(0);
    for (const p of result.parcels) expect(p.id).toMatch(/^68134\.4082\./);
    expect(result.checkUrl).toBe("https://akt16.org/check/?q=68134.4082");
    expectWellFormed(result);
  });

  it("finds a parcel's whole history by exact id, also from a unit id", () => {
    const exact = run("cad=68134.702.432");
    expect(exact.parcels[0].id).toBe("68134.702.432");
    expect(exact.parcels[0].permit).not.toBeNull();
    expect(exact.parcels[0].act16).not.toBeNull();
    expect(exact.parcels[0].docCount).toBe(exact.matched);
    const unit = run("cad=68134.702.432.1.39");
    expect(unit.parcels[0].id).toBe("68134.702.432");
    expect(run("q=68134.702.432").matchedBy).toBe("cad");
    expectWellFormed(exact);
  });

  it("matches a street within a neighbourhood", () => {
    const result = run("street=ул. Ралевица&hood=Манастирски ливади");
    expect(result.matchedBy).toBe("street");
    expect(result.query.street).toBe("Ралевица");
    expect(result.parcels.length).toBeGreaterThan(0);
    for (const p of result.parcels) expect(p.neighborhood).toMatch(/Манастирски ливади/);
    const hood = result.neighborhood!;
    expect(hood.name).toBe("Манастирски ливади");
    expect(hood.url).toMatch(/^https:\/\/akt16\.org\/neighborhood\/manastirski-livadi-(iztok|zapad)\/$/);
    expect(hood.parts!.length).toBeGreaterThanOrEqual(2);
    expect(result.checkUrl).toBe(`https://akt16.org/check/?q=${encodeURIComponent("Ралевица")}`);
    expectWellFormed(result);
  });

  it("matches a street on word boundaries and respects the neighbourhood filter", () => {
    const result = run("street=Кутловица");
    expect(result.matched).toBeGreaterThan(0);
    for (const p of result.parcels) expect(p.region).toBe("Слатина");
    const elsewhere = run("street=Кутловица&hood=Лозенец");
    expect(elsewhere.parcels).toEqual([]);
    expect(elsewhere.matchedBy).toBeNull();
    expect(elsewhere.neighborhood?.name).toBe("Лозенец");
  });

  it("summarises a neighbourhood on its own", () => {
    const result = run("hood=Младост 1");
    expect(result.matchedBy).toBe("hood");
    const hood = result.neighborhood!;
    expect(hood.name).toBe("Младост 1");
    expect(hood.url).toBe("https://akt16.org/neighborhood/mladost-1/");
    expect(hood.act16 + hood.permits).toBe(result.matched);
    expect(result.parcels.length).toBeGreaterThan(0);
    expectWellFormed(result);

    const lozen = run("hood=с. Лозен").neighborhood!;
    expect(lozen.name).toBe("с. Лозен");
    expect(lozen.newBuildings.length).toBeGreaterThan(0);
    expect(lozen.newBuildings.length).toBeLessThanOrEqual(5);
    const since = dateKey("16.10.2024");
    const keys = lozen.newBuildings.map((b) => dateKey(b.date));
    for (const key of keys) expect(key).toBeGreaterThanOrEqual(since);
    expect(keys).toEqual([...keys].sort((a, b) => b - a));
  });

  it("falls back to districts and the neighbourhood naming rules", () => {
    const district = run("hood=Витоша").neighborhood!;
    expect(district.name).toBe("район Витоша");
    expect(district.url).toBe("https://akt16.org/region/vitosha/");
    expect(resolveArea("Павлово")?.name).toBe("Павлово – Бъкстън");
    expect(resolveArea("Зона Б-5")?.name).toBe("Център");
    expect(resolveArea("Младост 1А")?.name).toBe("Младост 1");
    expect(resolveArea("Несъществуващ квартал")).toBeNull();
  });

  it("matches every free-text term", () => {
    const result = run("q=Манастирски ливади Ралевица");
    expect(result.matchedBy).toBe("q");
    expect(result.matched).toBeGreaterThan(0);
    expect(result.matched).toBeLessThan(run("q=Ралевица").matched + 1);
    expectWellFormed(result);
  });
});

describe("GET /api/lookup/", () => {
  const call = (qs: string) => (GET as any)({ request: new Request(`https://akt16.org/api/lookup/?${qs}`), locals: {} }) as Promise<Response>;

  it("returns JSON with CORS and cache headers", async () => {
    const res = await call("hood=Лозенец&street=Кутловица");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("checkUrl");
    expect(body.neighborhood.name).toBe("Лозенец");
  });

  it("rejects an empty query with a JSON 400 and answers preflight with 204", async () => {
    const res = await call("q=");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("empty_query");
    const pre = await (OPTIONS as any)({ request: new Request("https://akt16.org/api/lookup/", { method: "OPTIONS" }) });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
