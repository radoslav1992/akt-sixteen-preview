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
  changes.json         ← Кои документи е добавил всеки скрейп (60 дни) — за имейл известията
migrations/            ← D1 схема: профили, сесии, следени обекти (0001), имейли и известия (0002)
src/
  content/blog/        ← Статии (Markdown) с FAQ във frontmatter
  content/intl/        ← Ръководства на английски и руски (/en/, /ru/)
  lib/                 ← data, companies, places (райони/квартали), parcels (история на имот),
                         classify (тип сграда), stats, feeds (RSS/CSV), auth (D1),
                         email (шаблони + Cloudflare Email Service), alerts (дневни известия), search
  components/          ← Дизайн система: Icon, RecordCard, DocRow, графики (YearBars, MonthlyTrend),
                         SofiaMap (SVG карта), BulgariaMap, FollowButton, FaqList
  scripts/             ← Клиентски скриптове: register, check, map (Leaflet), account, watchlist
extension/             ← Разширение за Chrome/Firefox (MV3): панел с разрешения и Акт 16 в обявите за имоти
scripts/build-extension.mjs ← Пакетира extension/ в public/downloads/akt16-extension.zip (част от npm run build)
  pages/
    index.astro                ← Начало: търсене, пулс на регистрите, карта, нови сгради
    check.astro                ← Проверка на имот: двата регистъра, групирани по имот
    register/[id].astro        ← Търсене в регистъра (on demand; ?region= → 301)
    register/[id]/[slug].astro ← Документ (on demand) с история на имота
    region/…                   ← 24 района + пълни списъци /region/<район>/<регистър>/
    neighborhood/…             ← Квартали и села
    company/…                  ← Фирми: инвеститори и строителен надзор (само юридически лица)
    map.astro                  ← Интерактивна карта (Leaflet + OpenFreeMap/MapLibre, резервно OSM растер)
    new-buildings.astro        ← Нови жилищни сгради с Акт 16
    stats.astro, data.astro    ← Статистика и отворени данни (CSV/JSON)
    account/                   ← Вход, регистрация, следени обекти; verify, forgot, reset
    api/auth/*, api/watchlist/* ← API за профили (D1)
    api/alerts/*               ← Тестово известие и отписване с един клик
    api/lookup.ts              ← Публично API за разширението (CORS, кеш 1 ч)
    extension.astro            ← Страница на разширението за браузър
  worker.ts            ← Worker entry: Astro за заявките + cron за дневните известия
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

# След билд: проверка на статичните страници (h1, canonical, вътрешни линкове, sitemap)
node scripts/check-seo.mjs

# Проверка на страниците, рендерирани от worker-а (стартирайте wrangler dev преди това)
node scripts/check-worker.mjs http://localhost:8787

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

## Профили и следени обекти (D1)

Профилите, сесиите и списъците „Следени“ са в Cloudflare D1 база `akt16` (binding `DB` в `wrangler.jsonc`). Схемата е в `migrations/`.

```bash
# Локално
npx wrangler d1 migrations apply akt16 --local
# Production (само при нова миграция)
npx wrangler d1 migrations apply akt16 --remote
```

Без профил „Следени“ работи в localStorage на браузъра; след вход списъкът се слива с профила. Паролите се хешират с PBKDF2 (100 000 итерации). На безплатния план на Workers лимитът е 10 ms CPU на заявка — ако вход/регистрация връщат грешка 1102, намалете `PBKDF2_ITERATIONS` в `src/lib/auth.ts` (старите хешове продължават да работят).

## Имейли и известия (Cloudflare Email Service)

Сайтът изпраща три вида писма през binding-а `EMAIL` (`send_email` в `wrangler.jsonc`):

- **Потвърждение на имейла** — при регистрация (връзка, валидна 3 дни; може да се изпрати повторно от профила).
- **Нова парола** — от `/account/forgot/` (връзка, валидна 1 час, еднократна; изход от всички устройства).
- **Дневно известие** — cron в 10:20 UTC (след ежедневния скрейп и деплой) праща по едно писмо на всеки потвърден
  абонат, ако скрейпът е добавил документи по неговите следени райони, квартали, фирми, имоти, документи
  или запазени търсения. Кои документи са нови се взима от `data/changes.json`, а не от датата на документа,
  защото НАГ публикува с дни закъснение. Всяко писмо има `List-Unsubscribe` (отписване с един клик).

Настройка (еднократно):

1. Cloudflare Dashboard → **Compute → Email Service → Email Sending → Onboard Domain** → `akt16.org`.
   Cloudflare добавя MX/SPF/DKIM записите на `cf-bounce.akt16.org` и DMARC автоматично (домейнът трябва да е на Cloudflare DNS).
2. Изпращането до произволни адреси изисква **Workers Paid** план (3000 писма/месец са включени, след това $0.35 за 1000;
   новите акаунти имат и по-нисък дневен лимит, който расте с репутацията). Подателят е `EMAIL_FROM` от `vars`
   (по подразбиране `noreply@akt16.org`), отговорите отиват на `info@akt16.org`.
3. Приложете миграциите (`npx wrangler d1 migrations apply akt16 --remote`) и деплойнете — cron тригерът
   се регистрира от `triggers.crons`.

Докато домейнът не е готов, регистрацията и входът работят нормално; писмата не се изпращат, а cron-ът спира
без да губи известия (`E_SENDER_NOT_VERIFIED` → опитва пак на следващия ден). Изпратените писма и грешките
се записват в таблица `alert_log`; резултатът от всеки cron е в логовете на Worker-а (`[alerts] {...}`).

Локално `wrangler dev` симулира изпращането — писмата се записват като файлове и пътят се отпечатва в конзолата.
За ръчно пускане на cron локално: `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=20+10+*+*+*"`
(при Astro заявката минава през assets router-а, затова за този тест пуснете `wrangler dev -c` с копие на
`dist/server/wrangler.json` без `assets`).

## Разширение за браузър

`extension/` е разширение (Manifest V3, Chrome и Firefox 121+), което на страници с обяви (imot.bg, homes.bg,
imoti.net, alo.bg, olx.bg, address.bg, bazar.bg, yavlena.com, luximmo.bg) разпознава квартала, улицата или
кадастралния идентификатор и показва разрешенията за строеж и Акт 16 от `GET /api/lookup/` (параметри `q`, `cad`,
`street`, `hood`). Разширението говори само с akt16.org, без бисквитки и без да пази история.

`npm run build` пакетира ZIP-а в `public/downloads/akt16-extension.zip` (за ръчно инсталиране от `/extension/`).
За Chrome Web Store и Firefox Add-ons качете същия ZIP; подробности в `extension/README.md`.

## Деплой на Cloudflare

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
