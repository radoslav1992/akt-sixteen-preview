// Rough building-type classification from the free-text "Строеж / обект" description.
import type { Record } from "./data";

export type BuildingType = "multi" | "single" | "public" | "office" | "retail" | "industrial" | "energy" | "infra" | "other";

export const BUILDING_TYPES: Array<{ id: BuildingType; label: string; short: string }> = [
  { id: "multi", label: "Многофамилни жилищни сгради", short: "Жилищни блокове" },
  { id: "single", label: "Еднофамилни къщи и вили", short: "Къщи" },
  { id: "office", label: "Офис и административни сгради", short: "Офиси" },
  { id: "retail", label: "Търговия, хотели и услуги", short: "Търговия" },
  { id: "industrial", label: "Производство и складове", short: "Складове" },
  { id: "public", label: "Образование, здраве, спорт и култура", short: "Обществени" },
  { id: "energy", label: "Фотоволтаици и енергетика", short: "Енергетика" },
  { id: "infra", label: "Мрежи и инфраструктура", short: "Инфраструктура" },
  { id: "other", label: "Други и преустройства", short: "Други" },
];

const INFRA_START = /^(външн|ел\.?\s*захранван|електрозахранван|кабел|трафопост|газопровод|газоснабдяван|водопровод|канализац|сградн[аи]\s+(газ|вод|кан|отклон)|улиц|пътн|кръстовищ|оптичн|топлопровод|подстанция|базова\s+станция|присъединяван)/iu;

const RULES: Array<[BuildingType, RegExp]> = [
  ["energy", /фотоволтаи|соларн|ветрогенератор|ветроенерг/iu],
  ["multi", /многофамилн|жилищен\s+комплекс|жилищна\s+група|апартаментн[аи]\s+сград/iu],
  ["single", /еднофамилн|двуфамилн|\bкъща|вилна\s+сграда|сграда\s+за\s+отдих|жилищна\s+сграда/iu],
  ["public", /училищ|детска\s+градина|детски\s+ясл|болниц|медицинск|поликлиник|спортн|зала\s+за\s+спорт|църква|храм|читалищ|музей|библиотек|университет|социален|дом\s+за/iu],
  ["infra", /трафопост|кабелн|газопровод|водопровод|канализац|улиц|паркинг|мост|подлез|електропровод|телекомуникац|базова\s+станция|оптичн|топлопровод|подстанция|метро/iu],
  ["office", /офис|административн|бизнес/iu],
  ["retail", /магазин|търговск|ресторант|заведение|хотел|бензиностанц|автосервиз|автомивк|шоурум|супермаркет|мол\b|аптека|кафе/iu],
  ["industrial", /производств|склад|цех|логистич|хале|работилниц|промишлен/iu],
];

const cache = new WeakMap<Record, BuildingType>();

export function classify(record: Record): BuildingType {
  const cached = cache.get(record);
  if (cached) return cached;
  const text = record.object.replace(/\s+/g, " ").trim();
  let type: BuildingType = "other";
  if (INFRA_START.test(text)) type = "infra";
  else for (const [id, re] of RULES) if (re.test(text)) { type = id; break; }
  cache.set(record, type);
  return type;
}

export function buildingTypeLabel(id: BuildingType): string {
  return BUILDING_TYPES.find((t) => t.id === id)?.label ?? "Други";
}

const RENOVATION = /енергийна\s+ефективност|саниране|обновяване|реконструкция|преустройство|ремонт|присъединяване|асансьор/iu;

/** Energy-efficiency works and refurbishments of existing blocks are also filed as "многофамилна сграда". */
export function isRenovation(record: Record): boolean {
  return RENOVATION.test(record.object);
}

/** A new multi-family residential building (not a refurbishment of an existing one). */
export function isNewApartmentBuilding(record: Record): boolean {
  return classify(record) === "multi" && !isRenovation(record);
}
