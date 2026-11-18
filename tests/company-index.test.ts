import { describe, expect, it } from "vitest";
import {
  COMPANY_INDEX_MIN_DOCS,
  companySiteCount,
  getIndexableCompanies,
  getListedCompanies,
  isCompanyIndexable,
  relatedCompanies,
  topCompanies,
  type Company,
} from "../src/lib/companies";
import { includeInSitemap, noindexCompanyUrls } from "../src/lib/sitemap";
import type { Record, RegisterId } from "../src/lib/data";

const record = (number: string, scope: string, registerId: RegisterId = "permits"): { registerId: RegisterId; record: Record; role: "employer" } => ({
  registerId,
  role: "employer",
  record: { number, date: "01.02.2025", documentType: "Разрешение за строеж", status: null, takeEffect: null, issuer: "", employer: "", constructionOversight: "", object: "Жилищна сграда", region: "Младост", scope },
});
const company = (docs: ReturnType<typeof record>[]): Company => ({
  slug: "test-eood", name: "ТЕСТ", form: "ЕООД", display: "„ТЕСТ“ ЕООД", docs, employerCount: docs.length, oversightCount: 0,
  firstDate: "01.02.2025", lastDate: "01.02.2025", regions: [["Младост", docs.length]], publicBody: false,
});
const parcelA = "Идентификатор КККР (имот): 68134.4082.1234, Адрес: ул. Тест 1";
const parcelAbuilding = "Идентификатор КККР (сграда): 68134.4082.1234.1, Адрес: ул. Тест 1, вх. Б";
const parcelB = "Идентификатор КККР (имот): 68134.4082.999";

describe("company indexing rule", () => {
  it("indexes several documents or documents for several sites, not one project", () => {
    expect(isCompanyIndexable(company([record("1", parcelA)]))).toBe(false);
    // Two documents for the same parcel (a building id folds into its parcel): the document page already shows both.
    expect(companySiteCount(company([record("1", parcelA), record("2", parcelAbuilding)]))).toBe(1);
    expect(isCompanyIndexable(company([record("1", parcelA), record("2", parcelAbuilding)]))).toBe(false);
    expect(isCompanyIndexable(company([record("1", parcelA), record("2", parcelB)]))).toBe(true);
    expect(isCompanyIndexable(company([record("1", "Местност: Х"), record("2", "Местност: Y")]))).toBe(true);
    expect(isCompanyIndexable(company(Array.from({ length: COMPANY_INDEX_MIN_DOCS }, (_, i) => record(String(i), parcelA))))).toBe(true);
  });

  it("splits the real company pages into indexable and noindex", () => {
    const listed = getListedCompanies();
    const indexable = getIndexableCompanies();
    console.log("company pages", listed.length, "indexable", indexable.length, "noindex", listed.length - indexable.length);
    expect(indexable.length).toBeGreaterThan(listed.length * 0.6);
    expect(indexable.length).toBeLessThan(listed.length);
  });
});

describe("sitemap and page head share one predicate", () => {
  it("keeps every noindexed company out of the sitemap and every indexable one in it", () => {
    for (const c of getListedCompanies()) {
      expect(includeInSitemap(`https://akt16.org/company/${c.slug}/`), c.slug).toBe(isCompanyIndexable(c));
    }
    expect(noindexCompanyUrls().size).toBe(getListedCompanies().length - getIndexableCompanies().length);
  });

  it("still excludes account pages and the 404 page and keeps everything else", () => {
    expect(includeInSitemap("https://akt16.org/account/")).toBe(false);
    expect(includeInSitemap("https://akt16.org/404/")).toBe(false);
    expect(includeInSitemap("https://akt16.org/company/")).toBe(true);
    expect(includeInSitemap("https://akt16.org/register/act16/1-01012025/")).toBe(true);
  });
});

describe("internal links to company pages", () => {
  it("hub lists and related links point only at indexable pages", () => {
    for (const { company: c } of [...topCompanies("employer", 12), ...topCompanies("oversight", 12)]) expect(isCompanyIndexable(c)).toBe(true);
    const listed = getListedCompanies();
    const inbound = new Map<string, number>();
    for (const c of listed) {
      const related = relatedCompanies(c);
      expect(related.length).toBeLessThanOrEqual(6);
      expect(related).not.toContain(c);
      for (const r of related) {
        expect(isCompanyIndexable(r)).toBe(true);
        inbound.set(r.slug, (inbound.get(r.slug) ?? 0) + 1);
      }
    }
    const indexable = getIndexableCompanies().filter((c) => !c.publicBody);
    const linked = indexable.filter((c) => inbound.has(c.slug)).length;
    console.log("indexable companies linked from another company page", linked, "/", indexable.length);
    expect(linked / indexable.length).toBeGreaterThan(0.9);
  });
});
