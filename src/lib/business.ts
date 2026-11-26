// Copy and build-time numbers for /business/ („За бизнеса“). The title and description lengths are
// tested in tests/leads.test.ts and checked on the built page by scripts/check-seo.mjs.
import { changeEntries, latestChangeAt, newDocsSince, type ChangeEntry, type NewDoc } from "./alerts";
import { companiesInRecord } from "./companies";
import { classify, isNewApartmentBuilding } from "./classify";
import { dateKey } from "./format";

export const BUSINESS_PAGE_COPY = {
  title: "За бизнеса: нови разрешения за строеж и Акт 16 в София",
  heading: "За бизнеса: нови разрешения за строеж и Акт 16 в София",
  description: "Планиран бизнес план за брокери, кредитни посредници и фирми за услуги: нови разрешения за строеж и Акт 16 в цяла София. Заявете интерес.",
} as const;

export interface RecentAdditions {
  /** Days actually covered: the change log may be shorter than the period asked for. */
  days: number;
  permits: number;
  act16: number;
  /** Documents for residential buildings (blocks and houses), by the automatic classification. */
  residential: number;
  districts: number;
  /** Newest permits for new apartment buildings whose client is a company (never a private person). */
  sample: Array<NewDoc & { company: string }>;
}

/** What the daily scrapes added to the two registers in the last `days` days (data/changes.json). */
export function recentAdditions(days = 30, entries: ChangeEntry[] = changeEntries()): RecentAdditions {
  const latest = latestChangeAt(entries);
  if (!latest) return { days, permits: 0, act16: 0, residential: 0, districts: 0, sample: [] };
  const since = new Date(Date.parse(latest) - days * 86400000).toISOString();
  const docs = newDocsSince(since, entries);
  const covered = Math.ceil((Date.parse(latest) - Date.parse(entries[0].at)) / 86400000) + 1;
  const sample = docs
    .filter((d) => d.registerId === "permits" && isNewApartmentBuilding(d.record))
    .map((d) => ({ ...d, company: companiesInRecord(d.record, "permits")[0]?.display ?? "" }))
    .filter((d) => d.company)
    .sort((a, b) => dateKey(b.record.date) - dateKey(a.record.date))
    .slice(0, 5);
  return {
    days: Math.min(days, covered),
    permits: docs.filter((d) => d.registerId === "permits").length,
    act16: docs.filter((d) => d.registerId === "act16").length,
    residential: docs.filter((d) => ["multi", "single"].includes(classify(d.record))).length,
    districts: new Set(docs.map((d) => d.record.region).filter(Boolean)).size,
    sample,
  };
}
