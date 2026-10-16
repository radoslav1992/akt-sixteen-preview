// Readable casing for ALL-CAPS register text, shared by server pages and client scripts.
// Lower-cases the text, then restores what must stay capitalised: the first letter, Roman numerals,
// abbreviations and legal forms, and names that follow place markers (гр., с., р-н, ж.к., ул. …) or quotes.

const KEEP_UPPER = new Set([
  "упи", "пи", "кккр", "еоод", "оод", "еад", "ад", "дззд", "кд", "сд", "ет", "со", "наг", "днск", "пуп", "пурп", "рзп",
  "тп", "мтп", "вец", "ес", "ец", "нпз", "гпз", "сжс", "ии", "ввп", "гк", "сгкк", "бдж", "нкжи", "рпу", "дг", "су", "оу", "пгт",
]);
const ROMAN = /^[ivxlіІ]+[а-я]?$/u;
// Not after a number: "12 м." is metres, not "местност".
const MARKERS = /(?<!\d)(^|[\s(,;:"„])(гр\.|град|с\.|село|р-н|район|ж\.\s?к\.|жк|кв\.|квартал|м\.|местност|ул\.|улица|бул\.|булевард|в\.\s?з\.|вилна зона|пл\.|площад)\s*(["„]?)(\p{L})/gu;

export function readableCase(input: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  const letters = clean.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (letters.length < 12 || upper / letters.length < 0.7) return clean;

  let out = clean.toLocaleLowerCase("bg-BG").replace(/[\p{L}\p{N}]+/gu, (word) =>
    KEEP_UPPER.has(word) || ROMAN.test(word) ? word.toLocaleUpperCase("bg-BG") : word
  );
  out = out.replace(MARKERS, (_m, pre, marker, quote, ch) => `${pre}${marker} ${quote}${ch.toLocaleUpperCase("bg-BG")}`);
  out = out.replace(/(["„]\s*)(\p{L})/gu, (_m, q, ch) => q + ch.toLocaleUpperCase("bg-BG"));
  // New sentences: after a real word ending in . ! ? (not abbreviations like "к.к."), or after a colon.
  out = out.replace(/(^|\p{L}{3,}[.!?]\s+|:\s+)(\p{L})/gu, (_m, pre, ch) => pre + ch.toLocaleUpperCase("bg-BG"));
  out = out.replace(/(^|[^\p{L}])(софия|българия)(?![\p{L}])/gu, (_m, pre, w) => pre + w[0].toLocaleUpperCase("bg-BG") + w.slice(1));
  return out.replace(/ {2,}/g, " ");
}
