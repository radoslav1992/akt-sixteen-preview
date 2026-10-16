# Акт 16 Тракер

Mobile-first PWA (Progressive Web App) за проследяване на разрешенията за строеж и удостоверенията за въвеждане в експлоатация (Акт 16) на строежи в Столична община. Данните се събират автоматично от [НАГ — Направление "Архитектура и градоустройство"](https://nag.sofia.bg/Pages/Render/187). Може да се инсталира на телефон/таблет като приложение и работи офлайн.

## Какво проследяваме?

| Регистър | Какво е | Източник |
|----------|---------|----------|
| **Разрешения за строеж** | Одобрение за започване на строителство | [НАГ — Разрешения](https://nag.sofia.bg/RegisterBuildingPermitsPortal/Index) |
| **Акт 16** (Удостоверение за експлоатация) | Разрешение за обитаване на завършена сграда | [НАГ — УВЕ](https://nag.sofia.bg/RegisterCertificateForExploitationBuildings) |

> **Забележка:** Акт 14 (завършен груб строеж) и Акт 15 (готовност за приемане) не са достъпни като публични регистри на сайта на НАГ. Те са вътрешни строителни документи между строителя, надзора и общината.

## Архитектура

```
scripts/scrape.mjs     ← Node.js скрейпър за NAG Sofia API (поддържа множество регистри)
scripts/geocode.mjs    ← Инкрементално геокодиране (Nominatim + кеш)
scripts/geo-lib.mjs    ← Чисти функции: парсване на адрес/местност, заявки, точки
scripts/build-ekatte.mjs ← Генерира data/geo/ekatte-sofia.json
data/
  certificates.json    ← Акт 16 — удостоверения за експлоатация
  permits.json         ← Разрешения за строеж
  geo/
    ekatte-sofia.json  ← ЕКАТТЕ → център на населеното място (Столична община)
    cache.json         ← Кеш на заявките към Nominatim
    points.json        ← Координати по запис (за картата)
src/
  content/blog/        ← Markdown статии за SEO
  pages/
    index.astro        ← Начална страница с обобщение за двата регистъра
    register/[id].astro ← Таблица с филтри и пагинация (act16 / permits)
    blog/index.astro   ← Списък с всички статии
    blog/[slug].astro  ← Отделна статия
    stats.astro        ← Статистика по район и месец с табове
  lib/data.ts          ← Помощни функции за работа с данни
  layouts/Base.astro   ← Общ layout с OG мета тагове и PWA мета тагове
  layouts/BlogPost.astro ← Layout за статия със structured data
public/
  manifest.json        ← Web App Manifest (PWA)
  sw.js                ← Service Worker за офлайн достъп
  offline.html         ← Офлайн страница
  icons/               ← PWA икони (192, 512, maskable)
.github/workflows/
  scrape.yml           ← GitHub Action — ежедневно събиране на данни
```

## Разработка

```bash
# Инсталиране
npm install

# Стартиране на dev сървър
npm run dev

# Скрейпване на всички регистри (последните 90 дни)
npm run scrape

# Скрейпване само на Акт 16
node scripts/scrape.mjs 90 act16

# Скрейпване само на разрешения за строеж
node scripts/scrape.mjs 90 permits

# Пълно събиране (последната 1 година)
npm run scrape:full

# Геокодиране (до 400 заявки към Nominatim, макс. 8 мин)
npm run geocode

# Само преизграждане на data/geo/points.json от кеша (без мрежа)
node scripts/geocode.mjs --no-network

# Тестове
npm test

# Билд
npm run build
```

Необходим е Node.js >= 22.

## Данни

Скрейпърът работи в три стъпки за всеки регистър:

1. Зарежда страницата на НАГ за сесия и `searchQueryId`
2. Подава заявка за търсене по дата
3. Пагинира през `/Read` ендпойнта (Kendo Grid JSON)

Новите записи се обединяват с вече съществуващите (дедупликация по номер + дата).

### Полета

| Поле | Описание |
|------|----------|
| `number` | Номер на документа |
| `date` | Дата на издаване (ДД.ММ.ГГГГ) |
| `documentType` | Тип документ |
| `status` | Статус (Влязъл в сила / Отменен / Обжалван) |
| `issuer` | Издател |
| `employer` | Възложител (за разрешения за строеж) |
| `constructionOversight` | Строителен надзор (за Акт 16) |
| `object` | Описание на строежа |
| `region` | Район в София |
| `scope` | Адрес / местност / кадастрален идентификатор |

## Геокодиране

`scripts/geocode.mjs` намира координати на записите постепенно, всеки ден след скрейпването:

1. От полето `scope` се извличат адрес (`ул. Кутловица`), местност (`Манастирски ливади - запад`) и кадастрален идентификатор (`68134.702.9832` → ЕКАТТЕ `68134`).
2. За всеки запис се правят заявки към [Nominatim](https://nominatim.openstreetmap.org/) в ред адрес → местност, винаги в рамките на София (или на селото/града за записи извън града), напр. `ул. Иван Денкоглу 40, София, България`. Записите се обработват от най-новите към най-старите.
3. Всяка заявка (успешна или не) се пази в `data/geo/cache.json`. Неуспешните се опитват отново след 60 дни. Резултати извън Столична община се отхвърлят.
4. `data/geo/points.json` се генерира наново при всяко пускане: `"<регистър>:<номер>-<дата>": [lat, lng, точност]`.

| Точност | Значение |
|---------|----------|
| `1` | Адрес (улица и номер) |
| `2` | Местност / квартал |
| `3` | Център на селото/града по ЕКАТТЕ (само извън град София — центърът на София не носи информация) |

**Политика за използване на Nominatim.** Спазваме [правилата на OSMF](https://operations.osmfoundation.org/policies/nominatim/): последователни заявки, не повече от 1 в секунда (пауза ≥ 1,1 с), идентифициращ `User-Agent` (`akt16.org-geocoder/1.0`), кеширане на всички отговори, лимит на заявките за всяко пускане и спиране при грешки (с експоненциално изчакване при 429/5xx). Данните са © OpenStreetMap contributors (ODbL) — навсякъде, където се показват точките (карта, експорт), трябва да има атрибуция „© OpenStreetMap contributors“ с връзка към https://www.openstreetmap.org/copyright.

**Първоначално попълване (backfill).** Ежедневното пускане прави до 400 заявки за 8 минути. За да се попълнят наведнъж старите записи, стартирайте ръчно **Actions → Scrape NAG Certificates → Run workflow** с напр. `geocode_limit` = `2500` и `geocode_minutes` = `45` (задачата има лимит от 60 минути). Повторете, докато в лога `still to try` стигне 0.

Центровете на населените места (`data/geo/ekatte-sofia.json`) идват от [yurukov/Bulgaria-geocoding](https://github.com/yurukov/Bulgaria-geocoding) и се обновяват с `node scripts/build-ekatte.mjs`.

## GitHub Actions

- **Scrape** (`scrape.yml`): Всеки ден в 08:00 UTC — скрейпване и геокодиране. Може да се стартира и ръчно (`days_back`, `geocode_limit`, `geocode_minutes`).

## Деплой на Cloudflare Pages

Сайтът е достъпен на [akt16.org](https://akt16.org).

Свържете GitHub репозиторито директно в Cloudflare:

1. Отворете [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create → Pages → Connect to Git
2. Изберете репозиторито и клон `main`
3. Настройки за билд:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node.js version:** задайте environment variable `NODE_VERSION` = `22`

Cloudflare автоматично билдва и деплойва при всеки push към `main` (включително от ежедневния scrape).

## Лиценз

Данните са публична информация от НАГ — Столична община.
