# SEO maintenance

The search landing pages keep their existing paths. The home page targets broad Act 16 checks in Sofia; the registers support searches; the guides explain the process; district pages give local context.

## Deployment and Search Console

1. Enable **SSL/TLS → Edge Certificates → Always Use HTTPS** for `akt16.org` in Cloudflare. HTTP currently returns 200. Static assets can bypass the Astro worker, so an application-only redirect would not reliably cover every page. Check that HTTP requests receive a permanent redirect and preserve the path and query string.
2. After deployment, submit `https://akt16.org/sitemap-index.xml` to Search Console. The sitemap now includes the on-demand record URLs as well as static pages.
3. Inspect the homepage, both registers, an updated guide, a district page and a document detail page. Check Google's selected canonical after recrawling.
4. Compare subsequent 28-day periods, using the same filters. Track query groups for Act 16 checks, definitions and construction permits separately. Query rows omit some searches, and page totals may differ from property totals; do not add these dimensions together.

## URL and content conventions

- Canonicals, internal navigation and sitemap entries use HTTPS and trailing slashes. Filter query strings remain usable but canonicalize to the unfiltered register. Do not block those URLs in robots.txt: crawlers need to see their canonical tags.
- Both registers include the first 30 records in their initial HTML. Their full archives expose every record through ordinary links, with 100 records per page. The interactive filters still fetch the same JSON API.
- Record detail pages continue to render on demand. `astro.config.mjs` adds their URLs to the sitemap from the same checked-in datasets, deduplicated by URL. Do not stamp every document with today's date on each scrape.
- Keep the current article publication dates. Set `updatedDate` only when the article changes materially.
- Link factual guidance to the relevant official authority. Do not equate protocol №16 with a permission for use or a commissioning certificate, and do not infer that a building lacks a document merely because this dataset has no match.

## Verification

Run `npm test`, `npm run build`, then `node scripts/check-seo.mjs`. The last command checks rendered register rows, complete record coverage in the archives and sitemap, pagination links, district links, canonicals and updated article metadata.

Reference: [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Astro sitemap integration](https://docs.astro.build/en/guides/integrations-guide/sitemap/).
