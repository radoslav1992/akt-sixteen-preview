// Checks pages rendered on demand by the worker. Start it first (npm run preview, or wrangler dev),
// then run: node scripts/check-worker.mjs [base-url]   (default http://localhost:8787)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';

const base = process.argv[2] ?? 'http://localhost:8787';
const get = (path) => fetch(base + path, { redirect: 'manual' });

for (const [id, key] of [['act16', 'certificates'], ['permits', 'permits']]) {
  const records = JSON.parse(readFileSync(`data/${key}.json`, 'utf8'))[key];
  const res = await get(`/register/${id}/`);
  assert.equal(res.status, 200, `/register/${id}/`);
  const $ = load(await res.text());
  assert.equal($('#table-body tr').length, Math.min(30, records.length));
  assert.equal($('#mobile-list a').length, Math.min(30, records.length));
  assert.equal($('link[rel=canonical]').attr('href'), `https://akt16.org/register/${id}/`);
  assert($(`a[href="/register/${id}/archive/1/"]`).length);
  assert.equal($('h1').length, 1);

  // Legacy filter URLs that Google indexed must consolidate on the district lists.
  const region = records.find((r) => r.region)?.region;
  const legacy = await get(`/register/${id}/?region=${encodeURIComponent(region)}`);
  assert.equal(legacy.status, 301);
  assert.match(legacy.headers.get('location'), new RegExp(`/region/[a-z-]+/${id}/$`));

  const slug = `${records[0].number}-${records[0].date.replace(/\./g, '')}`;
  const doc = await get(`/register/${id}/${slug}/`);
  assert.equal(doc.status, 200);
  const d = load(await doc.text());
  assert.equal(d('link[rel=canonical]').attr('href'), `https://akt16.org/register/${id}/${slug}/`);
  assert.equal(d('h1').length, 1);
  assert(d('script[type="application/ld+json"]').map((_, s) => JSON.parse(d(s).text())['@type']).get().includes('GovernmentPermit'));

  const noSlash = await get(`/register/${id}/${slug}`);
  assert.equal(noSlash.status, 301, 'Document URLs without a trailing slash redirect');
  assert.equal((await get(`/register/${id}/0-01011900/`)).status, 404);
}
assert.equal((await get('/register/unknown/')).status, 404);
const me = await (await get('/api/auth/me/')).json();
assert('user' in me || me.error === 'accounts_unavailable');
console.log(`Worker checks passed against ${base}.`);
