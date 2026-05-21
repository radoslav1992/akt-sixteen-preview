import rawCertificates from "../../data/certificates.json";
import rawPermits from "../../data/permits.json";

export interface Record {
  number: string;
  date: string;
  documentType: string;
  status: string | null;
  takeEffect: string | null;
  issuer: string;
  employer: string;
  constructionOversight: string;
  object: string;
  region: string;
  scope: string;
}

export type RegisterId = "act16" | "permits";

interface RegisterMeta {
  id: RegisterId;
  label: string;
  shortLabel: string;
  records: Record[];
  lastUpdated: string;
  total: number;
}

const registers: { [K in RegisterId]: RegisterMeta } = {
  act16: {
    id: "act16",
    label: "Акт 16 — Удостоверения за експлоатация",
    shortLabel: "Акт 16",
    records: (rawCertificates as any).certificates ?? [],
    lastUpdated: (rawCertificates as any).lastUpdated ?? "",
    total: (rawCertificates as any).total ?? 0,
  },
  permits: {
    id: "permits",
    label: "Разрешения за строеж",
    shortLabel: "Разрешения",
    records: (rawPermits as any).permits ?? [],
    lastUpdated: (rawPermits as any).lastUpdated ?? "",
    total: (rawPermits as any).total ?? 0,
  },
};

export function getRegister(id: RegisterId): RegisterMeta {
  return registers[id];
}

export function getAllRegisters(): RegisterMeta[] {
  return Object.values(registers);
}

export function getRecords(registerId: RegisterId): Record[] {
  return registers[registerId].records;
}

export function getDistrictCounts(registerId: RegisterId): Map<string, number> {
  return getRecords(registerId)
    .filter((r) => r.region)
    .reduce((acc, r) => {
      acc.set(r.region, (acc.get(r.region) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());
}

export function getMonthlyBreakdown(registerId: RegisterId): Map<string, number> {
  return getRecords(registerId).reduce((acc, r) => {
    const [, month, year] = r.date.split(".");
    if (!month || !year) return acc;
    const key = `${month}.${year}`;
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
}

export function getYearlyBreakdown(registerId: RegisterId): Map<string, number> {
  return getRecords(registerId).reduce((acc, r) => {
    const [, , year] = r.date.split(".");
    if (!year) return acc;
    acc.set(year, (acc.get(year) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
}

export function getUniqueDistricts(registerId: RegisterId): string[] {
  return [
    ...new Set(getRecords(registerId).map((r) => r.region).filter(Boolean)),
  ].sort();
}

export function filterRecords(
  registerId: RegisterId,
  region?: string,
  search?: string
): Record[] {
  const lowerSearch = search?.toLowerCase();
  return getRecords(registerId).filter((r) => {
    const matchesRegion = !region || r.region === region;
    const matchesSearch =
      !lowerSearch ||
      r.object.toLowerCase().includes(lowerSearch) ||
      r.scope.toLowerCase().includes(lowerSearch) ||
      r.issuer.toLowerCase().includes(lowerSearch) ||
      r.number.includes(lowerSearch);
    return matchesRegion && matchesSearch;
  });
}

export function getCombinedStats(): {
  totalAct16: number;
  totalPermits: number;
  totalDistricts: number;
  lastUpdated: string;
} {
  const act16 = registers.act16;
  const permits = registers.permits;
  const allDistricts = new Set([
    ...getUniqueDistricts("act16"),
    ...getUniqueDistricts("permits"),
  ]);
  const latest =
    act16.lastUpdated > permits.lastUpdated
      ? act16.lastUpdated
      : permits.lastUpdated;

  return {
    totalAct16: act16.total,
    totalPermits: permits.total,
    totalDistricts: allDistricts.size,
    lastUpdated: latest,
  };
}

// --- URL slug helpers ---

const CYRILLIC_TO_LATIN: { [k: string]: string } = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

export function slugifyRegion(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((c) => CYRILLIC_TO_LATIN[c] ?? (/[a-z0-9-]/.test(c) ? c : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function recordSlug(r: Record): string {
  return `${r.number}-${r.date.replace(/\./g, "")}`;
}

export function findRecordBySlug(registerId: RegisterId, slug: string): Record | null {
  return getRecords(registerId).find((r) => recordSlug(r) === slug) ?? null;
}

const CADASTRE_RE = /Идентификатор\s+КККР[^:]*:\s*([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)/i;

export function extractCadastreId(scope: string): string | null {
  const m = scope.match(CADASTRE_RE);
  return m ? m[1] : null;
}

const ADDRESS_RE = /Адрес:\s*([^,]+(?:,\s*[^:,][^,]*)*?)(?=,\s*[А-Я][а-я]+:|$)/u;

export function extractAddress(scope: string): string | null {
  const m = scope.match(ADDRESS_RE);
  return m ? m[1].trim() : null;
}

export function findRelatedRecords(record: Record, sourceRegister: RegisterId): {
  sameCadastre: Record[];
  otherRegister: Record[];
} {
  const cadastreId = extractCadastreId(record.scope);
  if (!cadastreId) return { sameCadastre: [], otherRegister: [] };

  const sameCadastre = getRecords(sourceRegister).filter(
    (r) => r.number !== record.number && extractCadastreId(r.scope) === cadastreId
  );

  const otherId: RegisterId = sourceRegister === "act16" ? "permits" : "act16";
  const otherRegister = getRecords(otherId).filter(
    (r) => extractCadastreId(r.scope) === cadastreId
  );

  return { sameCadastre, otherRegister };
}

export function getTopParties(
  registerId: RegisterId,
  field: "employer" | "constructionOversight",
  limit = 10
): Array<[string, number]> {
  const counts = getRecords(registerId).reduce((acc, r) => {
    const v = (r[field] || "").trim();
    if (!v) return acc;
    acc.set(v, (acc.get(v) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function getRegionRecords(region: string): {
  act16: Record[];
  permits: Record[];
} {
  return {
    act16: getRecords("act16").filter((r) => r.region === region),
    permits: getRecords("permits").filter((r) => r.region === region),
  };
}

export function getAllRegionsWithSlugs(): Array<{ name: string; slug: string; act16: number; permits: number }> {
  const act16Counts = getDistrictCounts("act16");
  const permitsCounts = getDistrictCounts("permits");
  const all = new Set([...act16Counts.keys(), ...permitsCounts.keys()]);
  return [...all]
    .map((name) => ({
      name,
      slug: slugifyRegion(name),
      act16: act16Counts.get(name) ?? 0,
      permits: permitsCounts.get(name) ?? 0,
    }))
    .sort((a, b) => b.act16 + b.permits - (a.act16 + a.permits));
}

export function findRegionBySlug(slug: string): string | null {
  const all = getAllRegionsWithSlugs();
  return all.find((r) => r.slug === slug)?.name ?? null;
}
