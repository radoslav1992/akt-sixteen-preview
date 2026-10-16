// Data for the interactive map (/map/). Prerendered at build time.
// recs: one compact row per document, used to size district and village aggregates under the active filters.
// pts:  documents with a geocoded address or locality (precision 1–2), shown as individual markers.
import type { APIRoute } from "astro";
import points from "../../../data/geo/points.json";
import { getRecords, recordSlug, extractCadastreIds, type RegisterId } from "../../lib/data";
import { DISTRICTS, settlementOf, getNeighborhoods, NEIGHBORHOOD_PAGE_MIN_DOCS } from "../../lib/places";
import { BUILDING_TYPES, classify } from "../../lib/classify";
import { sentenceCase, slugify, truncate } from "../../lib/format";

const SOFIA = "68134";
const TOWNS = new Set(["00357", "02659", "07140"]);

export const GET: APIRoute = () => {
  const registers: RegisterId[] = ["act16", "permits"];
  const years = [...new Set(registers.flatMap((id) => getRecords(id).map((r) => +r.date.slice(-4))))].sort();
  const types = BUILDING_TYPES.map((t) => t.id);
  const districtIndex = new Map(DISTRICTS.map((d, i) => [d.name, i]));
  const settlements: Array<{ n: string; s: string; lat: number; lng: number; town: boolean }> = [];
  const settlementIndex = new Map<string, number>();
  const pointMap = (points as { points: { [key: string]: [number, number, number] } }).points;

  const recs: number[][] = [];
  const pts: Array<[number, number, number, number, string, string, string, string]> = [];

  registers.forEach((registerId, reg) => {
    for (const record of getRecords(registerId)) {
      const code = extractCadastreIds(record.scope)[0]?.slice(0, 5);
      let sIdx = -1;
      if (code && code !== SOFIA) {
        const settlement = settlementOf(code);
        if (settlement) {
          if (!settlementIndex.has(code)) {
            const town = TOWNS.has(code);
            const slug = slugify(`${town ? "gr" : "s"} ${settlement.name}`);
            const hasPage = (getNeighborhoods().get(slug)?.total ?? 0) >= NEIGHBORHOOD_PAGE_MIN_DOCS;
            settlementIndex.set(code, settlements.length);
            settlements.push({ n: settlement.name, s: hasPage ? slug : "", lat: settlement.lat, lng: settlement.lng, town });
          }
          sIdx = settlementIndex.get(code)!;
        }
      }
      const recIndex = recs.length;
      recs.push([reg, years.indexOf(+record.date.slice(-4)), types.indexOf(classify(record)), districtIndex.get(record.region) ?? -1, sIdx]);
      const key = `${registerId}:${recordSlug(record)}`;
      const point = pointMap[key];
      if (point && point[2] < 3) {
        pts.push([point[0], point[1], point[2], recIndex, key, record.number, record.date, truncate(sentenceCase(record.object), 80)]);
      }
    }
  });

  const payload = {
    updatedAt: (points as { updatedAt: string }).updatedAt,
    years,
    types,
    districts: DISTRICTS.map((d) => ({ n: d.name, s: d.slug, lat: d.lat, lng: d.lng })),
    settlements,
    recs,
    pts,
  };
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
};
