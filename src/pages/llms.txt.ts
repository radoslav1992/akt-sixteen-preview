import type { APIRoute } from "astro";
import { getCombinedStats } from "../lib/data";
import { getListedCompanies } from "../lib/companies";
import { getListedNeighborhoods } from "../lib/places";

// Plain-text guide for AI assistants and answer engines (https://llmstxt.org).
export const GET: APIRoute = () => {
  const s = getCombinedStats();
  const body = `# Акт 16 Тракер (akt16.org)

> Независим информационен сайт с данните от публичните регистри на Направление „Архитектура и градоустройство“ (НАГ) на Столична община: ${s.totalAct16} удостоверения за въвеждане в експлоатация („Акт 16“) и ${s.totalPermits} разрешения за строеж в София. Обновява се ежедневно. Не е официален регистър.

Важно при цитиране: „Акт 16“ в обявите обикновено означава въвеждане в експлоатация. Протокол образец 16 се съставя от държавна приемателна комисия; разрешение за ползване издава ДНСК (I–III категория); удостоверение за въвеждане в експлоатация издава общината (IV–V категория). Липсата на запис в сайта не доказва липса на документ.

## Инструменти
- [Проверка на имот](https://akt16.org/check/): търсене по адрес, квартал, фирма или идентификатор КККР; история на имота от разрешение до Акт 16
- [Регистър Акт 16](https://akt16.org/register/act16/)
- [Регистър на разрешенията за строеж](https://akt16.org/register/permits/)
- [Карта](https://akt16.org/map/)
- [Статистика](https://akt16.org/stats/)
- [Нови жилищни сгради с Акт 16](https://akt16.org/new-buildings/)
- [Отворени данни (CSV)](https://akt16.org/data/)

## Справочници
- [24 района на София](https://akt16.org/region/)
- [${getListedNeighborhoods().length} квартала и села](https://akt16.org/neighborhood/)
- [${getListedCompanies().length} фирми: инвеститори и строителен надзор](https://akt16.org/company/)

## Ръководства
- [Какво е Акт 16](https://akt16.org/blog/kakvo-e-akt-16/)
- [Проверка за Акт 16 по адрес](https://akt16.org/blog/proverka-akt-16-online/)
- [Акт 16 образец](https://akt16.org/blog/akt-16-obrazets/)
- [Акт 14, 15 и 16](https://akt16.org/blog/etapi-na-stroitelstvo-akt-14-15-16/)
- [Разрешение за строеж](https://akt16.org/blog/razreshenie-za-stroezh/)
- [Разрешение за ползване и удостоверение](https://akt16.org/blog/razreshenie-za-polzvane/)
- [От разрешение до Акт 16 — срокове](https://akt16.org/blog/ot-razreshenie-do-akt-16/)
- [Act 16 in Bulgaria (English)](https://akt16.org/en/act-16-bulgaria/)
- [Акт 16 в Болгарии (русский)](https://akt16.org/ru/akt-16-bolgariya/)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
