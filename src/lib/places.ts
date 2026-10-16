// Districts (райони) and neighbourhoods (квартали / местности) of Sofia municipality.
import ekatte from "../../data/geo/ekatte-sofia.json";
import { getRecords, extractCadastreIds, type Record, type RegisterId } from "./data";
import { slugify } from "./format";

export interface District {
  name: string;
  slug: string;
  /** Approximate centre of the district's built-up area, used for map bubbles. */
  lat: number;
  lng: number;
}

// Approximate centres; good enough for district-level bubbles, not for addresses.
export const DISTRICTS: District[] = [
  ["Средец", 42.6905, 23.333], ["Красно село", 42.6795, 23.2855], ["Възраждане", 42.6985, 23.306],
  ["Оборище", 42.699, 23.345], ["Сердика", 42.7165, 23.3165], ["Подуяне", 42.711, 23.362],
  ["Слатина", 42.6855, 23.373], ["Изгрев", 42.6725, 23.355], ["Лозенец", 42.6705, 23.322],
  ["Триадица", 42.673, 23.302], ["Красна поляна", 42.6965, 23.2725], ["Илинден", 42.709, 23.2875],
  ["Надежда", 42.7355, 23.299], ["Искър", 42.663, 23.405], ["Младост", 42.6495, 23.379],
  ["Студентски", 42.6485, 23.344], ["Витоша", 42.643, 23.283], ["Овча купел", 42.68, 23.246],
  ["Люлин", 42.7155, 23.252], ["Връбница", 42.737, 23.274], ["Нови Искър", 42.8, 23.35],
  ["Кремиковци", 42.757, 23.47], ["Панчарево", 42.603, 23.41], ["Банкя", 42.707, 23.147],
].map(([name, lat, lng]) => ({ name: name as string, slug: slugify(name as string), lat: lat as number, lng: lng as number }));

const DISTRICT_BY_NAME = new Map(DISTRICTS.map((d) => [d.name, d]));
export function getDistrict(name: string): District | undefined {
  return DISTRICT_BY_NAME.get(name);
}

type Settlement = { name: string; lat: number; lng: number };
const SETTLEMENTS = ekatte as unknown as { [code: string]: Settlement };
const SOFIA_CITY = "68134";
// Towns inside the municipality; their quarters are matched by name first.
const TOWNS = new Set(["00357", "02659", "07140"]);

export function settlementOf(code: string): Settlement | undefined {
  return SETTLEMENTS[code];
}

export interface Neighborhood {
  slug: string;
  name: string;
  /** "кв." / "ж.к." / "м." / "с." / "гр." — used in copy only. */
  kind: string;
  ekatte?: string;
}

// Patterns run against the upper-cased "Местност" value. Order matters: specific before generic.
const RULES: Array<[RegExp, string, string]> = [
  [/МАНАСТИ[РЕ]СКИ\s+ЛИВАДИ\s*[-–]?\s*ЗАПАД/, "Манастирски ливади – запад", "кв."],
  [/МАНАСТИ[РЕ]СКИ\s+ЛИВАДИ\s*[-–]?\s*ИЗТОК/, "Манастирски ливади – изток", "кв."],
  [/МАНАСТИ[РЕ]СКИ\s+ЛИВАДИ/, "Манастирски ливади", "кв."],
  [/КРЪСТОВА\s+ВАДА/, "Кръстова вада", "кв."],
  [/ЮЖЕН\s+ПАРК/, "Южен парк", "м."],
  [/(В\.?\s*З\.?|ВИЛНА\s+ЗОНА).*МАЛИНОВА\s+ДОЛИНА|МАЛИНОВА\s+ДОЛИНА.*(БУНКЕРА|ГЕРЕНА|ДУПКИТЕ|II\s*[АБ]|1\s+ЧАСТ|ОКОЛОВРЪСТЕН)/, "Вилна зона Малинова долина", "в.з."],
  [/МАЛИНОВА\s+ДОЛИНА/, "Малинова долина", "ж.к."],
  [/ВЕЦ\s*[-–]?\s*СИМЕОНОВО/, "Витоша – ВЕЦ Симеоново", "м."],
  [/СИМЕОНОВО/, "Симеоново", "кв."],
  [/ДРАГАЛЕВС[А]?КА\s+СПИРКА/, "Драгалевска спирка", "м."],
  [/ДРАГАЛЕВЦИ/, "Драгалевци", "кв."],
  [/КИНОЦЕ?Н?ТЪР/, "Киноцентъра", "в.з."],
  [/БОЯН/, "Бояна", "кв."],
  [/КНЯЖЕВО/, "Княжево", "кв."],
  [/ПАВЛОВО|БЪКСТОН/, "Павлово – Бъкстън", "кв."],
  [/КАРПУЗИЦА/, "Карпузица", "ж.к."],
  [/ГЪРДОВА\s+ГЛАВА/, "Гърдова глава", "м."],
  [/БОТАНИЧЕСКА\s+Г/, "Ботаническа градина", "м."],
  [/КИЛИИТЕ/, "Вилна зона Килиите", "в.з."],
  [/ГОРНА\s+БАНЯ/, "Горна баня", "кв."],
  [/ОВЧА\s+КУПЕЛ\s*[-–]?\s*2(?!\d)/, "Овча купел 2", "ж.к."],
  [/ОВЧА\s+КУПЕЛ/, "Овча купел", "ж.к."],
  [/СУХОДОЛ/, "Суходол", "кв."],
  [/ЮБИЛЕЙНА\s+ГОРА/, "Юбилейна гора", "м."],
  [/(В\.?\s*З\.?|ВИЛНА\s+ЗОНА)\s*ЛЮЛИН/, "Вилна зона Люлин", "в.з."],
  [/ФИЛИПОВЦИ/, "Филиповци", "кв."],
  [/ЗАХАРНА\s+ФАБРИКА/, "Захарна фабрика", "кв."],
  [/МОДЕРНО\s+ПРЕДГРАДИЕ/, "Модерно предградие", "кв."],
  [/ОБЕЛЯ\s*[-–]?\s*2(?!\d)/, "Обеля 2", "ж.к."],
  [/ОБЕЛЯ/, "Обеля", "ж.к."],
  [/ЛОМСКО\s+ШОСЕ/, "Ломско шосе", "м."],
  [/ТРИЪГЪЛНИКА/, "Триъгълника", "ж.к."],
  [/ИЛИЯНЦИ/, "Илиянци", "кв."],
  [/ТРЕБИЧ/, "Требич", "кв."],
  [/ТОЛСТОЙ/, "Толстой", "ж.к."],
  [/ХАДЖИ\s+ДИМИТЪР/, "Хаджи Димитър", "ж.к."],
  [/ОРЛАНДОВЦИ|МАЛАШЕВЦИ/, "Орландовци – Малашевци", "кв."],
  [/БЕНКОВСКИ/, "Бенковски", "кв."],
  [/ВОЕННА\s+РАМПА/, "Военна рампа", "кв."],
  [/ФОНДОВИ\s+ЖИЛИЩА/, "Фондови жилища", "ж.к."],
  [/СУХА(ТА)?\s+РЕКА/, "Сухата река", "ж.к."],
  [/ГЕО\s+МИЛЕВ/, "Гео Милев", "кв."],
  [/РЕДУТА/, "Редута", "кв."],
  [/ПОДУ[ЕЯ]НЕ/, "Подуяне", "кв."],
  [/СМИРНЕНСКИ/, "Христо Смирненски", "ж.к."],
  [/ЛЕВСКИ/, "Левски", "ж.к."],
  [/БОТЕВГРАДСКО\s+ШОСЕ/, "Ботевградско шосе", "м."],
  [/(^|\s)IV\s*КМ|4[-\s]?ТИ\s+КМ|ЧЕТВЪРТИ\s+КИЛОМЕТЪР/, "4-ти километър", "м."],
  [/КЪРО/, "Изток – Къро", "м."],
  [/ДИАНАБАД/, "Дианабад", "ж.к."],
  [/^(М\.\s*)?(Ж\.?\s*К\.?\s*)?ИЗТОК/, "Изток", "ж.к."],
  [/ИЗГРЕВ/, "Изгрев", "ж.к."],
  [/ХЛАДИЛНИКА/, "Хладилника", "кв."],
  [/ЛОЗЕНЕЦ/, "Лозенец", "кв."],
  [/ДЪРВЕНИЦА/, "Дървеница", "кв."],
  [/МУСАГЕНИЦА/, "Мусагеница", "ж.к."],
  [/СТУДЕНТСКИ\s+ГРАД/, "Студентски град", "ж.к."],
  [/МЛАДОСТ\s*[-–]?\s*1(?!\d)/, "Младост 1", "ж.к."],
  [/МЛАДОСТ\s*[-–]?\s*2(?!\d)/, "Младост 2", "ж.к."],
  [/МЛАДОСТ\s*[-–]?\s*3(?!\d)/, "Младост 3", "ж.к."],
  [/МЛАДОСТ\s*[-–]?\s*4(?!\d)/, "Младост 4", "ж.к."],
  [/МЛАДОСТ/, "Младост", "ж.к."],
  [/ГОРУБЛЯНЕ/, "Горубляне", "кв."],
  [/АМЕРИКАНСКИ\s+КОЛЕЖ/, "Вилна зона Американски колеж", "в.з."],
  [/ДРУЖБА\s*[-–]?\s*2(?!\d)/, "Дружба 2", "ж.к."],
  [/ДРУЖБА\s*[-–]?\s*1(?!\d)/, "Дружба 1", "ж.к."],
  [/ДРУЖБА/, "Дружба", "ж.к."],
  [/ИСКЪР\s*[-–]?\s*(ЮГ|СЕВЕР)/, "Индустриална зона Искър", "м."],
  [/ВРАЖДЕБНА/, "Враждебна", "кв."],
  [/ЧЕЛОПЕЧЕНЕ/, "Челопечене", "кв."],
  [/БОТУНЕЦ/, "Ботунец", "кв."],
  [/СЕСЛАВЦИ/, "Сеславци", "кв."],
  [/КРЕМИКОВЦИ/, "Кремиковци", "кв."],
  [/КУРИЛО/, "Курило", "кв."],
  [/КУМАРИЦА|ВОЙКОВ|СЛАВОВЦИ/, "Кумарица", "кв."],
  [/ГНИЛЯНЕ/, "Гниляне", "кв."],
  [/ГРАДОМАН/, "Градоман", "кв."],
  [/ВРЪБНИЦА\s*[-–]?\s*1(?!\d)/, "Връбница 1", "ж.к."],
  [/ВРЪБНИЦА\s*[-–]?\s*2(?!\d)/, "Връбница 2", "ж.к."],
  [/НАДЕЖДА\s*[-–]?\s*(ЧАСТ\s*)?1/, "Надежда 1", "ж.к."],
  [/НАДЕЖДА\s*[-–]?\s*(ЧАСТ\s*)?2/, "Надежда 2", "ж.к."],
  [/НАДЕЖДА\s*[-–]?\s*(ЧАСТ\s*)?3/, "Надежда 3", "ж.к."],
  [/НАДЕЖДА\s*[-–]?\s*(ЧАСТ\s*)?4/, "Надежда 4", "ж.к."],
  [/НАДЕЖДА/, "Надежда", "ж.к."],
  [/ЛЮЛИН\s*[-–]?\s*(\d{1,2})\s*(М\.?\s*Р|МР|\b)/, "Люлин $1", "ж.к."],
  [/ЛЮЛИН/, "Люлин", "ж.к."],
  [/ГОЦЕ\s+ДЕЛЧЕВ/, "Гоце Делчев", "ж.к."],
  [/ИВАН\s+ВАЗОВ/, "Иван Вазов", "кв."],
  [/СТРЕЛБИЩЕ/, "Стрелбище", "ж.к."],
  [/(^|\s)ЗДРАВЕ/, "Здраве", "ж.к."],
  [/ХИПОДРУМА/, "Хиподрума", "ж.к."],
  [/БЕЛИ\s+БРЕЗИ/, "Бели брези", "ж.к."],
  [/БОРОВО/, "Борово", "ж.к."],
  [/ЛАГЕРА/, "Лагера", "кв."],
  [/БУКАТА/, "Буката", "м."],
  [/КРАСНО\s+СЕЛО/, "Красно село", "ж.к."],
  [/РАЗСАДНИКА/, "Разсадника", "ж.к."],
  [/ФАКУЛТЕТА/, "Факултета", "кв."],
  [/ЗАПАДЕН\s+ПАРК/, "Западен парк", "ж.к."],
  [/КРАСНА\s+ПОЛЯНА/, "Красна поляна", "ж.к."],
  [/ВЪЛЧО\s+ИВАНОВ/, "Вълчо Иванов", "кв."],
  [/БАНИШОРА/, "Банишора", "кв."],
  [/(СВ\.?|СВЕТА)\s+ТРОИЦА/, "Света Троица", "ж.к."],
  [/МЕДИЦИНСКА\s+АКАДЕМИЯ/, "Медицинска академия", "кв."],
  [/ЯВОРОВ/, "Яворов", "кв."],
  [/ГЕВГЕЛИЙСКИ/, "Гевгелийски", "кв."],
  [/ЗОН[АИ]\s*[-–]?\s*[АБВГ](\s|-|\d|$)|ГЛАВЕН\s+ГРАДСКИ\s+ЦЕНТЪР|ГГЦ|ЦЕНТЪРА|(^|\s)Г-1\d|ЦЕНТЪР\s*[-–]\s*ЗОНА|ИЗВЪНГРАДСКА\s+ЧАСТ/, "Център", "м."],
];

const LOCALITY_RE = /Местност:\s*(.*?)(?:,\s*(?:Квартал по регулация|УПИ|Идентификатор|Планоснимачен|Адрес|ПИ)[^:]*:|$)/u;

export function extractLocality(scope: string): string | null {
  const m = scope.match(LOCALITY_RE);
  if (!m) return null;
  const clean = m[1].replace(/["„“”'«»]/g, " ").replace(/\s+/g, " ").trim();
  return clean || null;
}

const neighborhoodCache = new Map<string, Neighborhood | null>();

export function neighborhoodOf(record: Record): Neighborhood | null {
  const key = record.scope;
  if (neighborhoodCache.has(key)) return neighborhoodCache.get(key)!;
  const result = resolveNeighborhood(record);
  neighborhoodCache.set(key, result);
  return result;
}

function resolveNeighborhood(record: Record): Neighborhood | null {
  const code = extractCadastreIds(record.scope)[0]?.slice(0, 5);
  const village = code && code !== SOFIA_CITY && !TOWNS.has(code) ? SETTLEMENTS[code] : undefined;
  if (village) return { slug: slugify(`s ${village.name}`), name: village.name, kind: "с.", ekatte: code };

  const locality = extractLocality(record.scope)?.toLocaleUpperCase("bg-BG");
  if (locality) {
    for (const [re, name, kind] of RULES) {
      const m = locality.match(re);
      if (m) {
        const resolved = name.replace("$1", m[1] ?? "");
        return { slug: slugify(resolved), name: resolved, kind };
      }
    }
  }
  const town = code && TOWNS.has(code) ? SETTLEMENTS[code] : undefined;
  if (town) return { slug: slugify(`gr ${town.name}`), name: town.name, kind: "гр.", ekatte: code };
  return null;
}

export interface NeighborhoodSummary extends Neighborhood {
  act16: Record[];
  permits: Record[];
  regions: Array<[string, number]>;
  total: number;
}

/** Minimum number of documents before a neighbourhood gets its own page. */
export const NEIGHBORHOOD_PAGE_MIN_DOCS = 5;

let summaries: Map<string, NeighborhoodSummary> | null = null;

export function getNeighborhoods(): Map<string, NeighborhoodSummary> {
  if (summaries) return summaries;
  const map = new Map<string, NeighborhoodSummary>();
  for (const registerId of ["act16", "permits"] as RegisterId[]) {
    for (const record of getRecords(registerId)) {
      const n = neighborhoodOf(record);
      if (!n) continue;
      let s = map.get(n.slug);
      if (!s) {
        s = { ...n, act16: [], permits: [], regions: [], total: 0 };
        map.set(n.slug, s);
      }
      s[registerId].push(record);
      s.total++;
    }
  }
  for (const s of map.values()) {
    const counts = new Map<string, number>();
    for (const r of [...s.act16, ...s.permits]) if (r.region) counts.set(r.region, (counts.get(r.region) ?? 0) + 1);
    s.regions = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }
  return (summaries = map);
}

export function getListedNeighborhoods(): NeighborhoodSummary[] {
  return [...getNeighborhoods().values()]
    .filter((n) => n.total >= NEIGHBORHOOD_PAGE_MIN_DOCS)
    .sort((a, b) => b.total - a.total);
}

export function neighborhoodLabel(n: Neighborhood): string {
  return n.kind === "с." || n.kind === "гр." ? `${n.kind} ${n.name}` : n.name;
}
