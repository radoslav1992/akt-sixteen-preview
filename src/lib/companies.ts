// Company directory built from the "Възложител" (permits) and "Строителен надзор" (Акт 16) fields.
// Only legal entities and public bodies get pages: private individuals named in the
// registers are never turned into profiles.
import { getRecords, recordSlug, type Record, type RegisterId } from "./data";
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

/** Minimum number of documents before a company gets its own indexable page. */
export const COMPANY_PAGE_MIN_DOCS = 2;

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
export function getListedCompanies(): Company[] {
  return [...getCompanyIndex().values()]
    .filter((c) => c.docs.length >= COMPANY_PAGE_MIN_DOCS)
    .sort((a, b) => b.docs.length - a.docs.length || a.name.localeCompare(b.name, "bg"));
}

export function hasCompanyPage(slug: string): boolean {
  const company = getCompanyIndex().get(slug);
  return !!company && company.docs.length >= COMPANY_PAGE_MIN_DOCS;
}

export function topCompanies(role: CompanyRole, limit = 10, sinceYear?: number): Array<{ company: Company; count: number }> {
  return getListedCompanies()
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
