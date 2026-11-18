// Which built pages go into the sitemap. astro.config.mjs loads this module at build time
// (through Vite, so it can read the same data files as the pages), and tests import it directly.
import { getListedCompanies, isCompanyIndexable } from "./companies";
import { SITE_URL } from "./seo";

let noindexCompanies: Set<string> | null = null;

/** Absolute URLs of company pages that render `noindex, follow` (see isCompanyIndexable). */
export function noindexCompanyUrls(): Set<string> {
  return (noindexCompanies ??= new Set(
    getListedCompanies().filter((c) => !isCompanyIndexable(c)).map((c) => `${SITE_URL}/company/${c.slug}/`),
  ));
}

/** Filter for @astrojs/sitemap: account pages, the 404 page and noindexed company pages stay out. */
export function includeInSitemap(url: string): boolean {
  if (/\/account\/|\/404\/?$/.test(url)) return false;
  return !noindexCompanyUrls().has(url);
}
