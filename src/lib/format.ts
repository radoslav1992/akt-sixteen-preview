// Formatting helpers shared by pages. Dates in the registers use ДД.ММ.ГГГГ.

const CYRILLIC_TO_LATIN: { [k: string]: string } = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

/** Transliterates Bulgarian text into an ASCII URL slug (Streamlined System). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((c) => CYRILLIC_TO_LATIN[c] ?? (/[a-z0-9-]/.test(c) ? c : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
export const MONTHS_SHORT = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"];

export function parseBgDate(s: string): Date {
  const [d, m, y] = s.split(".");
  return new Date(Date.UTC(+y, +m - 1, +d));
}

/** ДД.ММ.ГГГГ → ГГГГ-ММ-ДД */
export function isoDate(s: string): string {
  const [d, m, y] = s.split(".");
  return `${y}-${m}-${d}`;
}

/** Sortable number for ДД.ММ.ГГГГ dates (ГГГГММДД). */
export function dateKey(s: string): number {
  const [d, m, y] = s.split(".");
  return +y * 10000 + +m * 100 + +d;
}

export function longDate(s: string): string {
  const [d, m, y] = s.split(".");
  return `${+d} ${MONTHS[+m - 1] ?? m} ${y}`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("bg-BG").replace(/ /g, " ");
}

export function plural(n: number, one: string, many: string): string {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

/** Human duration in months/years: 26 → "2 г. 2 мес." */
export function fmtMonths(months: number): string {
  const total = Math.round(months);
  if (total < 1) return "под месец";
  const years = Math.floor(total / 12);
  const rest = total % 12;
  if (!years) return `${rest} мес.`;
  return rest ? `${years} г. ${rest} мес.` : `${years} г.`;
}

export function monthsBetween(from: string, to: string): number {
  return (parseBgDate(to).getTime() - parseBgDate(from).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

export function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

/** Register text is often ALL CAPS; make it readable without losing names and abbreviations. */
export { readableCase as sentenceCase } from "./textcase";
