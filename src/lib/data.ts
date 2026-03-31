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
