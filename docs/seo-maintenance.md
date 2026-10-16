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

## Deployment and Search Console

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

Run `npm test`, `npm run build`, then `node scripts/check-seo.mjs` (every static page: one h1, self canonical, description, no broken internal links, no legacy filter links, sitemap coverage). With `wrangler dev` running, run `node scripts/check-worker.mjs http://localhost:8787` for the on-demand pages and redirects.

Reference: [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Astro sitemap integration](https://docs.astro.build/en/guides/integrations-guide/sitemap/).
