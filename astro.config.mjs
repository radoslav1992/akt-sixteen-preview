// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

// The sitemap uses the same indexing rule as the page heads (src/lib/sitemap.ts → companies.ts).
// Vite loads the TypeScript module so it reads data/*.json exactly as the pages do.
const { module: sitemapRules } = await runnerImport(fileURLToPath(new URL('./src/lib/sitemap.ts', import.meta.url)));

// Individual records and the register search pages are rendered on demand,
// so Astro cannot discover them itself.
const recordDates = new Map();
const recordPages = [['act16', 'certificates'], ['permits', 'permits']].flatMap(([id, key]) => {
  const data = JSON.parse(readFileSync(new URL(`./data/${key}.json`, import.meta.url), 'utf8'));
  return data[key].map((record) => {
    const url = `https://akt16.org/register/${id}/${record.number}-${record.date.replace(/\./g, '')}/`;
    const [d, m, y] = record.date.split('.');
    recordDates.set(url, `${y}-${m}-${d}`);
    return url;
  });
});
const onDemandPages = ['https://akt16.org/register/act16/', 'https://akt16.org/register/permits/'];

// https://astro.build/config
export default defineConfig({
  site: "https://akt16.org",
  trailingSlash: "always",
  // The JSON API checks Origin itself (src/lib/auth.ts). Astro's form check would also block the
  // one-click unsubscribe POSTs that mail providers send without an Origin header.
  security: { checkOrigin: false },
  integrations: [sitemap({
    customPages: [...new Set([...onDemandPages, ...recordPages])],
    filter: (page) => sitemapRules.includeInSitemap(page),
    // A document never changes after it is issued, so its issue date is an honest lastmod.
    serialize: (item) => (recordDates.has(item.url) ? { ...item, lastmod: recordDates.get(item.url) } : item),
  })],
  adapter: cloudflare(),
});
