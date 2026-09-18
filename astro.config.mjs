// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';
import { readFileSync } from 'node:fs';

// Individual records are rendered on demand, so Astro cannot discover them itself.
const recordPages = [['act16', 'certificates'], ['permits', 'permits']].flatMap(([id, key]) => {
  const data = JSON.parse(readFileSync(new URL(`./data/${key}.json`, import.meta.url), 'utf8'));
  return data[key].map((record) => `https://akt16.org/register/${id}/${record.number}-${record.date.replace(/\./g, '')}/`);
});

// https://astro.build/config
export default defineConfig({
  site: "https://akt16.org",
  trailingSlash: "always",
  integrations: [sitemap({ customPages: [...new Set(recordPages)] })],
  adapter: cloudflare(),
});
