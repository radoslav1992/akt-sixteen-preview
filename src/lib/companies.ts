// Company directory built from the "Възложител" (permits) and "Строителен надзор" (Акт 16) fields.
// Only legal entities and public bodies get pages: private individuals named in the
// registers are never turned into profiles.
import { extractCadastreIds, getRecords, parcelIdOf, recordSlug, type Record, type RegisterId } from "./data";
import { dateKey, slugify } from "./format";

export type CompanyRole = "employer" | "oversight";

export interface CompanyRef {
  slug: string;
  name: string;
  form: string;
  display: string;
}

export interface CompanyDoc {
  registerId: RegisterId;
  record: Record;
  role: CompanyRole;
}

export interface Company extends CompanyRef {
  docs: CompanyDoc[];
  employerCount: number;
  oversightCount: number;
  firstDate: string;
  lastDate: string;
  regions: Array<[string, number]>;
  publicBody: boolean;
}

/** Minimum number of documents before a company gets its own page. */
export const COMPANY_PAGE_MIN_DOCS = 2;

/**
 * A company page is indexable when it shows at least this many documents, or documents for at least
 * COMPANY_INDEX_MIN_SITES different sites. A page with two documents about one parcel repeats the
 * property history that the document page already shows, so it stays reachable but `noindex, follow`.
 * The page head (src/pages/company/[slug].astro) and the sitemap (src/lib/sitemap.ts) both use
 * isCompanyIndexable(); do not re-implement the rule elsewhere.
 */
export const COMPANY_INDEX_MIN_DOCS = 3;
export const COMPANY_INDEX_MIN_SITES = 2;

// Legal forms, tolerating Latin look-alike letters that appear in the source data ("EООД").
const FORM_PATTERN = "[АA]ДСИЦ|[ЕE][ОO][ОO]Д|ДЗЗД|[ОO][ОO]Д|[ЕE][АA]Д|[КK]Д[АA]|[АA]Д|[КK]Д|[СC]Д";
const FORM_AT_END = new RegExp(`(?:^|(?<=[\\s"]))(${FORM_PATTERN})\\.?\\s*$`, "u");
const FORM_AT_START = new RegExp(`^(ЕТ|ET|${FORM_PATTERN})\\s+(.+)$`, "u");
const MUNICIPALITY = /^(СТОЛИЧНА\s+ОБЩИНА|СО\s*[-–]|СО\s+Р|СО-Р)/u;
const LATIN_LOOKALIKES: { [k: string]: string } = { E: "Е", O: "О", A: "А", D: "Д", T: "Т", K: "К", C: "С" };

/** Splits a party list on commas that are outside quotes. */
export function splitParties(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "„") quoted = true;
    else if ((ch === "“" || ch === "”") && quoted) quoted = false;
    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function cleanQuotes(s: string): string {
  return s.replace(/[„“”«»]/g, '"').replace(/''/g, '"').replace(/\s+/g, " ").trim();
}

function canonicalForm(token: string): string {
  return token.replace(/[EOADTKC]/g, (c) => LATIN_LOOKALIKES[c] ?? c);
}

/** Parses one party into a company reference, or null for natural persons and unparseable text. */
export function parseCompany(party: string): CompanyRef | null {
  const raw = cleanQuotes(party);
  if (!raw) return null;
  const upper = raw.toLocaleUpperCase("bg-BG");
  if (MUNICIPALITY.test(upper)) {
    return { slug: "stolichna-obshtina", name: "СТОЛИЧНА ОБЩИНА", form: "", display: "Столична община" };
  }

  let name: string | null = null;
  let form = "";
  const atEnd = upper.match(FORM_AT_END);
  const atStart = upper.match(FORM_AT_START);
  if (atEnd && atEnd.index! > 0) {
    form = canonicalForm(atEnd[1]);
    name = upper.slice(0, atEnd.index);
  } else if (atStart) {
    form = canonicalForm(atStart[1]);
    name = atStart[2];
  }
  if (!name) return null;

  // Names such as "ЛИДЛ БЪЛГАРИЯ ЕООД ЕНД КО" КД keep their inner legal-form words.
  const core = name.replace(/"/g, " ").replace(/\s+/g, " ").replace(/^[\s\-–,.]+|[\s\-–,.]+$/g, "").toLocaleUpperCase("bg-BG");
  if (core.length < 2 || !/[А-ЯA-Z]/u.test(core)) return null;
  const display = form === "ЕТ" ? `ЕТ „${core}“` : `„${core}“ ${form}`;
  return { slug: slugify(`${core} ${form}`), name: core, form, display };
}

export function companiesInRecord(record: Record, registerId: RegisterId): Array<CompanyRef & { role: CompanyRole }> {
  const role: CompanyRole = registerId === "permits" ? "employer" : "oversight";
  const field = role === "employer" ? record.employer : record.constructionOversight;
  const seen = new Set<string>();
  const out: Array<CompanyRef & { role: CompanyRole }> = [];
  for (const party of splitParties(field || "")) {
    const company = parseCompany(party);
    if (company && !seen.has(company.slug)) {
      seen.add(company.slug);
      out.push({ ...company, role });
    }
  }
  return out;
}

let cache: Map<string, Company> | null = null;

function buildIndex(): Map<string, Company> {
  const index = new Map<string, Company>();
  for (const registerId of ["permits", "act16"] as RegisterId[]) {
    for (const record of getRecords(registerId)) {
      for (const ref of companiesInRecord(record, registerId)) {
        let company = index.get(ref.slug);
        if (!company) {
          company = { ...ref, docs: [], employerCount: 0, oversightCount: 0, firstDate: record.date, lastDate: record.date, regions: [], publicBody: ref.form === "" };
          index.set(ref.slug, company);
        }
        company.docs.push({ registerId, record, role: ref.role });
        if (ref.role === "employer") company.employerCount++;
        else company.oversightCount++;
        if (dateKey(record.date) < dateKey(company.firstDate)) company.firstDate = record.date;
        if (dateKey(record.date) > dateKey(company.lastDate)) company.lastDate = record.date;
      }
    }
  }
  for (const company of index.values()) {
    company.docs.sort((a, b) => dateKey(b.record.date) - dateKey(a.record.date));
    const regions = new Map<string, number>();
    for (const doc of company.docs) if (doc.record.region) regions.set(doc.record.region, (regions.get(doc.record.region) ?? 0) + 1);
    company.regions = [...regions.entries()].sort((a, b) => b[1] - a[1]);
  }
  return index;
}

export function getCompanyIndex(): Map<string, Company> {
  return (cache ??= buildIndex());
}

/** Companies that get a page, most active first. */
let listedCache: Company[] | null = null;

export function getListedCompanies(): Company[] {
  return (listedCache ??= [...getCompanyIndex().values()]
    .filter((c) => c.docs.length >= COMPANY_PAGE_MIN_DOCS)
    .sort((a, b) => b.docs.length - a.docs.length || a.name.localeCompare(b.name, "bg"))).slice();
}

export function hasCompanyPage(slug: string): boolean {
  const company = getCompanyIndex().get(slug);
  return !!company && company.docs.length >= COMPANY_PAGE_MIN_DOCS;
}

/** The site a document is about: its first cadastral parcel, or else its normalised scope text. */
export function siteKey(record: Record): string {
  const ids = extractCadastreIds(record.scope);
  if (ids.length) return `parcel:${parcelIdOf(ids[0])}`;
  return `scope:${record.scope.toLocaleLowerCase("bg-BG").replace(/\s+/g, " ").trim()}`;
}

const siteCounts = new WeakMap<Company, number>();

export function companySiteCount(company: Company): number {
  let n = siteCounts.get(company);
  if (n === undefined) siteCounts.set(company, (n = new Set(company.docs.map((d) => siteKey(d.record))).size));
  return n;
}

/** The single rule for whether a company page may be indexed and listed in the sitemap. */
export function isCompanyIndexable(company: Company): boolean {
  const docs = company.docs.length;
  if (docs < COMPANY_PAGE_MIN_DOCS) return false;
  return docs >= COMPANY_INDEX_MIN_DOCS || companySiteCount(company) >= COMPANY_INDEX_MIN_SITES;
}

/** Companies whose pages are indexable, most active first. */
let indexableCache: Company[] | null = null;

export function getIndexableCompanies(): Company[] {
  return (indexableCache ??= getListedCompanies().filter(isCompanyIndexable));
}

export function isCompanyPathIndexable(slug: string): boolean {
  const company = getCompanyIndex().get(slug);
  return !!company && isCompanyIndexable(company);
}

export function topCompanies(role: CompanyRole, limit = 10, sinceYear?: number): Array<{ company: Company; count: number }> {
  return getIndexableCompanies()
    .filter((c) => !c.publicBody)
    .map((company) => ({
      company,
      count: company.docs.filter((d) => d.role === role && (!sinceYear || +d.record.date.slice(-4) >= sinceYear)).length,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function companyDocUrl(doc: CompanyDoc): string {
  return `/register/${doc.registerId}/${recordSlug(doc.record)}/`;
}

export function mainRole(company: Company): CompanyRole {
  return company.employerCount >= company.oversightCount ? "employer" : "oversight";
}

/**
 * Indexable companies with the same main role and main district, taken from around the company's
 * place in the activity ranking. Every company in a district then links to its neighbours, so
 * smaller profiles get links from other profiles and not only from the directory and the sitemap.
 */
export function relatedCompanies(company: Company, limit = 6): Company[] {
  const region = company.regions[0]?.[0];
  if (!region || company.publicBody) return [];
  const role = mainRole(company);
  const peers = getIndexableCompanies().filter((c) => !c.publicBody && c.regions[0]?.[0] === region && mainRole(c) === role);
  let at = peers.indexOf(company);
  if (at < 0) at = peers.findIndex((c) => c.docs.length <= company.docs.length);
  if (at < 0) at = peers.length;
  const others = peers.filter((c) => c !== company);
  const start = Math.max(0, Math.min(at - Math.floor(limit / 2), others.length - limit));
  return others.slice(start, start + limit);
}
