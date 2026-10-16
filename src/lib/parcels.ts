// Parcel (поземлен имот) history: links permits and Акт 16 records that share a cadastral identifier.
import { extractCadastreIds, getRecords, parcelIdOf, type Record, type RegisterId } from "./data";
import { dateKey, monthsBetween } from "./format";

export interface ParcelDoc {
  registerId: RegisterId;
  record: Record;
}

let index: Map<string, ParcelDoc[]> | null = null;

export function getParcelIndex(): Map<string, ParcelDoc[]> {
  if (index) return index;
  index = new Map();
  for (const registerId of ["permits", "act16"] as RegisterId[]) {
    for (const record of getRecords(registerId)) {
      for (const id of extractCadastreIds(record.scope)) {
        const list = index.get(id) ?? [];
        list.push({ registerId, record });
        index.set(id, list);
      }
    }
  }
  for (const list of index.values()) list.sort((a, b) => dateKey(a.record.date) - dateKey(b.record.date));
  return index;
}

let groups: Map<string, ParcelDoc[]> | null = null;

/** Like getParcelIndex, but documents filed under a building or unit id are folded into their parcel. */
export function getParcelGroups(): Map<string, ParcelDoc[]> {
  if (groups) return groups;
  const seen = new Map<string, Set<Record>>();
  groups = new Map();
  for (const [id, docs] of getParcelIndex()) {
    const key = parcelIdOf(id);
    const list = groups.get(key) ?? [];
    const records = seen.get(key) ?? new Set<Record>();
    for (const doc of docs) if (!records.has(doc.record)) (records.add(doc.record), list.push(doc));
    groups.set(key, list);
    seen.set(key, records);
  }
  for (const list of groups.values()) list.sort((a, b) => dateKey(a.record.date) - dateKey(b.record.date));
  return groups;
}

/** Every document on the same parcel(s) as `record`, oldest first, including the record itself. */
export function parcelHistory(record: Record): ParcelDoc[] {
  const ids = extractCadastreIds(record.scope);
  const seen = new Set<Record>();
  const docs: ParcelDoc[] = [];
  for (const id of ids) {
    for (const doc of getParcelIndex().get(id) ?? []) {
      if (!seen.has(doc.record)) {
        seen.add(doc.record);
        docs.push(doc);
      }
    }
  }
  return docs.sort((a, b) => dateKey(a.record.date) - dateKey(b.record.date));
}

export interface PipelineMatch {
  permit: Record;
  certificate: Record;
  months: number;
}

let matches: PipelineMatch[] | null = null;

/** For each Акт 16 record, the latest earlier permit on the same parcel. */
export function pipelineMatches(): PipelineMatch[] {
  if (matches) return matches;
  matches = [];
  for (const certificate of getRecords("act16")) {
    let best: Record | null = null;
    for (const id of extractCadastreIds(certificate.scope)) {
      for (const doc of getParcelIndex().get(id) ?? []) {
        if (doc.registerId !== "permits") continue;
        if (dateKey(doc.record.date) >= dateKey(certificate.date)) continue;
        if (!best || dateKey(doc.record.date) > dateKey(best.date)) best = doc.record;
      }
    }
    if (best) matches.push({ permit: best, certificate, months: monthsBetween(best.date, certificate.date) });
  }
  return matches;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function durationStats(list: PipelineMatch[]): { count: number; median: number; q1: number; q3: number } {
  const sorted = list.map((m) => m.months).sort((a, b) => a - b);
  return { count: sorted.length, median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75) };
}
