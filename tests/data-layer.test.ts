import { describe, expect, it } from "vitest";
import { parseCompany, splitParties, getListedCompanies, companiesInRecord } from "../src/lib/companies";
import { getNeighborhoods, getListedNeighborhoods, neighborhoodOf } from "../src/lib/places";
import { classify } from "../src/lib/classify";
import { pipelineMatches, durationStats, parcelHistory } from "../src/lib/parcels";
import { extractCadastreIds, getRecords } from "../src/lib/data";

describe("company parsing", () => {
  it("normalizes quotes, spacing and legal forms", () => {
    expect(parseCompany('"ММВ-Инженеринг" ЕООД')).toMatchObject({ name: "ММВ-ИНЖЕНЕРИНГ", form: "ЕООД", slug: "mmv-inzhenering-eood" });
    expect(parseCompany('"АРКА КОНСУЛТ"ЕООД')?.slug).toBe("arka-konsult-eood");
    expect(parseCompany('НОРМИС ЕООД')?.slug).toBe(parseCompany('"НОРМИС" ЕООД')?.slug);
    expect(parseCompany('"ИВТ КОНСУЛТ" EООД')?.form).toBe("ЕООД");
    expect(parseCompany('"ЛИДЛ БЪЛГАРИЯ ЕООД ЕНД КО" КД')).toMatchObject({ name: "ЛИДЛ БЪЛГАРИЯ ЕООД ЕНД КО", form: "КД" });
    expect(parseCompany("СТОЛИЧНА ОБЩИНА - район \"Красно село\"")?.slug).toBe("stolichna-obshtina");
  });

  it("never turns private individuals into companies", () => {
    for (const person of ["Иван Иванов", "МОХАМЕД МЕЗИАД", "Милен  Йовков", "Етажна собственост на Жилищна №7"]) {
      expect(parseCompany(person)).toBeNull();
    }
  });

  it("splits party lists without breaking quoted names", () => {
    expect(splitParties('"ХАГА ИНВЕСТ" ООД, "ВАСПЕКТ" ЕООД, Маргаритка Станкова')).toHaveLength(3);
  });

  it("lists active companies with stable slugs", () => {
    const listed = getListedCompanies();
    expect(listed.length).toBeGreaterThan(500);
    expect(new Set(listed.map((c) => c.slug)).size).toBe(listed.length);
    console.log("companies listed", listed.length, listed.slice(0, 5).map((c) => `${c.display}:${c.docs.length}`));
  });
});

describe("places and classification", () => {
  it("assigns most records to a neighbourhood", () => {
    const all = [...getRecords("act16"), ...getRecords("permits")];
    const assigned = all.filter((r) => neighborhoodOf(r)).length;
    const listed = getListedNeighborhoods();
    console.log("neighbourhood coverage", assigned, "/", all.length, "listed", listed.length, "total", getNeighborhoods().size);
    console.log(listed.slice(0, 40).map((n) => `${n.name}:${n.total}`).join(", "));
    expect(assigned / all.length).toBeGreaterThan(0.7);
  });

  it("classifies building types", () => {
    const counts: Record<string, number> = {};
    for (const r of getRecords("act16")) counts[classify(r)] = (counts[classify(r)] ?? 0) + 1;
    console.log("act16 types", counts);
    expect(classify({ object: "Многофамилна жилищна сграда с магазини и подземни гаражи" } as any)).toBe("multi");
    expect(classify({ object: "Външно ел. захранване на многофамилна жилищна сграда" } as any)).toBe("infra");
    expect(classify({ object: "Еднофамилна жилищна сграда" } as any)).toBe("single");
  });
});

describe("parcels", () => {
  it("extracts several cadastral ids", () => {
    expect(extractCadastreIds("Идентификатор КККР (имот): 68134.702.9832, 68134.702.9833, Адрес: ул. X 1")).toEqual(["68134.702.9832", "68134.702.9833"]);
    expect(extractCadastreIds("Местност: X")).toEqual([]);
  });

  it("matches permits to later certificates", () => {
    const stats = durationStats(pipelineMatches());
    console.log("pipeline", stats);
    expect(stats.count).toBeGreaterThan(1000);
    const sample = pipelineMatches()[0];
    expect(parcelHistory(sample.certificate).length).toBeGreaterThan(1);
  });
});
