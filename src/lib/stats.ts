// Aggregations used by the home, district, company and statistics pages (computed at build time).
import { getRecords, type Record, type RegisterId } from "./data";
import { dateKey } from "./format";

export function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export const yearOf = (r: Record) => r.date.slice(-4);
export const monthOf = (r: Record) => `${r.date.slice(-4)}-${r.date.slice(3, 5)}`;

export function byYear(records: Record[]): Map<string, number> {
  return countBy(records, yearOf);
}

export function byMonth(records: Record[]): Map<string, number> {
  return countBy(records, monthOf);
}

/** Latest data date across both registers (ДД.ММ.ГГГГ). */
export function latestRecordDate(): string {
  let best = "01.01.2000";
  for (const id of ["act16", "permits"] as RegisterId[]) {
    for (const r of getRecords(id)) if (dateKey(r.date) > dateKey(best)) best = r.date;
  }
  return best;
}

/** Last `n` calendar months ending with the month of the latest record, oldest first ("ГГГГ-ММ"). */
export function recentMonths(n: number, endDate = latestRecordDate()): string[] {
  const [, m, y] = endDate.split(".").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function sortByDateDesc(records: Record[]): Record[] {
  return [...records].sort((a, b) => dateKey(b.date) - dateKey(a.date));
}

export function inLastDays(records: Record[], days: number, endDate = latestRecordDate()): Record[] {
  const [d, m, y] = endDate.split(".").map(Number);
  const end = Date.UTC(y, m - 1, d);
  const from = end - days * 86400000;
  return records.filter((r) => {
    const [rd, rm, ry] = r.date.split(".").map(Number);
    const t = Date.UTC(ry, rm - 1, rd);
    return t > from && t <= end;
  });
}

/** Last `n` complete months: ends the month before the latest record, since the current month is still filling up. */
export function completeMonths(n: number, endDate = latestRecordDate()): string[] {
  const [, m, y] = endDate.split(".").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const end = `01.${String(prev.getUTCMonth() + 1).padStart(2, "0")}.${prev.getUTCFullYear()}`;
  return recentMonths(n, end);
}
