// Shared by the property check page, the watchlist and the email digests so a saved search
// matches the same documents everywhere.
export const normalizeQuery = (s: string) =>
  s.toLowerCase().replace(/[„“”"']/g, "").replace(/(^|\s)(ул|бул|ж\.?к|кв|м|с|гр)\.\s*/g, "$1$2. ").replace(/\s+/g, " ").trim();

export const queryTerms = (q: string) => normalizeQuery(q).split(" ").filter(Boolean);

/** Every term of the query appears in the text (after the same normalisation). */
export function matchesQuery(terms: string[], text: string): boolean {
  if (!terms.length) return false;
  const hay = normalizeQuery(text);
  return terms.every((t) => hay.includes(t));
}

/** Parcel part of a cadastral id: a building (…720.1) or unit (…720.1.21) id → its parcel (68134.1932.720). */
export const parcelIdOf = (id: string): string => id.split(".").slice(0, 3).join(".");
