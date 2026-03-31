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
data/
  certificates.json    ← Акт 16 — удостоверения за експлоатация
  permits.json         ← Разрешения за строеж
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

## GitHub Actions

- **Scrape** (`scrape.yml`): Всеки ден в 08:00 UTC. Може да се стартира и ръчно.

## Деплой на Cloudflare Pages

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
