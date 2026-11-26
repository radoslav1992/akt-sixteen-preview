# SEO maintenance

The search landing pages keep their existing paths. The home page targets broad Act 16 checks in Sofia; the registers support searches; the guides explain the process; district, neighbourhood and company pages give local and entity context.

## October 2026 redesign — decisions from Search Console (30 Mar–16 Oct 2026)

| Signal in GSC | Change |
| --- | --- |
| `?region=` filter URLs (http and https, some with encoded newlines) collected impressions for "разрешения за строеж <район>" | `/register/<id>/` is rendered on demand and 301-redirects `?region=` to new static lists `/region/<slug>/<id>/` (paginated, self-canonical). The client keeps the district filter in the URL hash, so no new parameter URLs are created. Internal links never point to `?region=` (enforced by `check-seo.mjs`). |
| Document URLs without a trailing slash had impressions | On-demand routes 301 to the trailing-slash URL (verified by `check-worker.mjs`). |
| "какво е / какво означава акт 16" — position 5–6, CTR 0–1 % | Definition guide retitled, opening answer rewritten, FAQ + FAQPage JSON-LD; home FAQ answers the same questions. |
| "кой издава", "кога се издава", "колко струва", "документи за акт 16", "акт 16 за къща" | New guide `/blog/akt-16-za-kashta/`. |
| "акт 16 образец", "как изглежда акт 16", "акт 14 образец" | New guide `/blog/akt-16-obrazets/`. |
| "регистър разрешения за ползване", "акт 16 и разрешение за ползване" | New guide `/blog/razreshenie-za-polzvane/`. |
| "апартаменти с акт 16 софия", "ново строителство акт 16" | `/new-buildings/` landing page and `/blog/apartamenti-s-akt-16-sofia/`. |
| Company names (investors, supervision firms) ranked 10–50 via single documents | `/company/<slug>/` profiles for legal entities and public bodies with ≥2 documents. Private individuals never get pages. |
| Neighbourhood queries ("обеля 2", "люлин 5", "манастирски ливади", "искър 85") | `/neighborhood/<slug>/` for 144 neighbourhoods and villages (≥5 documents). |
| Impressions from US/UK/NL/DE and Russian queries with ~0 clicks | `/en/act-16-bulgaria/` and `/ru/akt-16-bolgariya/`, hreflang-linked to the Bulgarian definition guide. |
| AI-assistant style queries ("дай линк", "провери и двете") | `/llms.txt` summary; clear definitional answers in guides. |

Titles that already earned clicks were kept (home H1, permits register title, district titles, document titles).

## November 2026 — decisions from Search Console (to 15 Nov 2026)

| Signal | Change |
| --- | --- |
| 22 of 75 inspected sitemap URLs not indexed, almost all `/company/` ("Discovered – currently not indexed" / "URL is unknown") | Company pages need ≥2 documents to exist (unchanged). They are indexable only with ≥3 documents or documents for ≥2 different sites (parcel, else scope text): `isCompanyIndexable()` in `src/lib/companies.ts`. The others (two documents about one parcel, which the document page's property history already shows) render `noindex, follow`, stay linked from their documents and the directory, and are left out of the sitemap by `src/lib/sitemap.ts`, which `astro.config.mjs` loads with Vite's `runnerImport` so both use the same rule. Note: the non-indexed sample included large profiles (35 and 60 documents) and the indexed sample many two-document pages, so crawl priority, not thinness, explains most of it; the sitemap is ~91 % document URLs. |
| Company pages reachable mainly via the directory and sitemap | Each company page links up to six indexable peers with the same main role and main district (neighbours in the activity ranking), so almost every indexable profile has a link from another profile. District, neighbourhood, home and statistics lists link only indexable profiles. |
| Low CTR on `/blog/kakvo-e-akt-16/`, `/register/act16/`, `/blog/razreshenie-za-stroezh/` | Answer-first titles ≤ 60 characters and 120–155-character descriptions. Blog posts can set `seoTitle` (full `<title>`, H1 keeps `title`); register copy lives in `REGISTER_PAGE_COPY` (`src/lib/seo.ts`). The home page title and H1 keep "Акт 16 — …" (the page that ranks for "акт 16"). Lengths are tested in `tests/seo.test.ts`. |
| Slashless static URLs answered with a temporary 307 by the asset handler | `run_worker_first` in `wrangler.jsonc` sends page paths (everything except file types) to the worker, which answers 301 to the slash URL on HTTPS (`trailingSlashRedirect()`) and otherwise serves the static page from `ASSETS`. Static page views now count as worker requests; if that ever matters, replace it with a Cloudflare Redirect Rule (path without "/" and without "." → 301 to path + "/") and remove the setting. Do not add a negative `"!/*/"` rule: negative rules never fall back to the worker and would 404 the on-demand pages. |

## November 2026 — Google's follow-up searches for "акт 16"

akt16.org is the first organic result for "акт 16". Google offers these refinements: Проверка, Регистър, Образец, Кой издава, За къща, Къща без, Изисквания, За гараж, София, Копие на, Акт 15 и.

| Refinement | Page |
| --- | --- |
| За гараж | New guide `/blog/akt-16-za-garazh/` |
| Къща без | New guide `/blog/kashta-bez-akt-16/` |
| Копие на | New guide `/blog/kopie-na-akt-16/` |
| Изисквания | New guide `/blog/iziskvaniya-za-akt-16/` |
| Кой издава | Section `/blog/kakvo-e-akt-16/#koy-izdava` (by category, answer first); the other guides link to the anchor |
| Акт 15 и | `/blog/etapi-na-stroitelstvo-akt-14-15-16/` retitled "Акт 14, Акт 15 и Акт 16: разлики …", with a comparison table and what buying at "груб строеж" means |
| Проверка | `/blog/proverka-akt-16-online/` explains the property check and the register field by field (keep it in step with `src/scripts/check.ts`) |

`tests/seo.test.ts` checks these guides' title and description lengths, FAQ count and links to the register, `/check/` and `/map/`, that every `/blog/` link and anchor between guides resolves, and that each new guide is linked from at least two others. `check-seo.mjs` checks that they are built, in the sitemap, on the blog index and in `llms.txt`, and that `#…` links to guides point at an existing id. Word counts: `wc -w` in the C locale skips Cyrillic words, so count with `LC_ALL=C.UTF-8`.

## November 2026 — email alerts made visible, „За бизнеса“

Only 9 accounts for ~2,900 visits a month: the follow button said „Следи“ and nothing mentioned email.

| Change | Where |
| --- | --- |
| Button „Извести ме по имейл“ with one line saying what arrives, per kind of page | `FollowButton.astro`; state-dependent text in `src/scripts/follow.ts` |
| Permit without a certificate on `/check/` → „Кажете ми, когато сградата получи Акт 16“ (follows the parcel) | `src/scripts/check.ts` |
| Explainer (one email a day, free, one-click unsubscribe) on the home page (`#izvestiya`) and both register pages | `AlertsExplainer.astro` |
| `/business/`: planned business plan, clearly not available yet, with an interest form | `src/pages/business.astro`, `src/lib/leads.ts`, `src/lib/business.ts` |

Copy rules: alerts are a daily digest (never "instant"); a document without a cadastral id cannot be matched by the digest, so its button only saves it and promises no email; `/business/` promises no price and no date. Analytics events `follow_click` {kind, signed_in}, `alert_signup` {kind} and `business_lead` carry no email, item name or search text.

`check-seo.mjs` checks the button text and hint on district, neighbourhood and company pages, the explainer, and `/business/` (title ≤ 60, description 120–155, sitemap, form fields, footer and `/data/` links, privacy section). `check-worker.mjs` checks the document page button and the form endpoint with requests that store nothing.

## Deployment and Search Console

0. D1 migrations are not applied by the deploy (the Cloudflare build runs `npm run build` and `wrangler deploy` only). Apply a new migration by hand first: `npx wrangler d1 migrations apply akt16 --remote`.
1. Enable **SSL/TLS → Edge Certificates → Always Use HTTPS** for `akt16.org` in Cloudflare. GSC still lists `http://` URLs. The worker middleware redirects HTTP for on-demand pages, but static pages are served directly by Cloudflare, so only the dashboard setting covers every URL.
2. After deployment, resubmit `https://akt16.org/sitemap-index.xml`. It now includes the on-demand register pages, every document (with its issue date as `lastmod`), districts, district lists, neighbourhoods, companies and guides.
3. In URL Inspection, test one legacy URL such as `/register/permits/?region=Люлин` and confirm the 301 to `/region/lyulin/permits/`.
4. Compare subsequent 28-day periods with the same filters. Track query groups separately: Act 16 checks, definitions, permits, companies, neighbourhoods, new buildings, English/Russian. Query rows omit some searches, and page totals may differ from property totals; do not add these dimensions together.

## URL and content conventions

- Canonicals, internal navigation and sitemap entries use HTTPS and trailing slashes. Filter query strings (`q`, `type`, `from`, `to`) remain usable but canonicalize to the unfiltered register. Do not block them in robots.txt: crawlers need to see the canonical tags.
- Both registers include the first 30 records in their initial HTML. Full archives and district lists expose every record through ordinary links. The interactive filters fetch `/api/<id>.json`.
- Document pages render on demand. Do not stamp documents with today's date on each scrape.
- Keep article publication dates. Set `updatedDate` only when the article changes materially (`check-seo.mjs` asserts the current dates of the four core guides — update it with them).
- Link factual guidance to the relevant official authority. Do not equate protocol №16 with a permission for use or a commissioning certificate, and do not infer that a building lacks a document merely because this dataset has no match.
- Company and neighbourhood pages are derived automatically (`src/lib/companies.ts`, `src/lib/places.ts`). When adding neighbourhood rules, put specific patterns before generic ones.

## Verification

Run `npm test`, `npm run build`, then `node scripts/check-seo.mjs` (every static page: one h1, self canonical, description, no broken or slashless internal links, no legacy filter links, no `http://` links, sitemap coverage, no `noindex` page in the sitemap). With `wrangler dev` running, run `node scripts/check-worker.mjs http://localhost:8787` for the on-demand pages and redirects.

Reference: [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Astro sitemap integration](https://docs.astro.build/en/guides/integrations-guide/sitemap/).
