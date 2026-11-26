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
  // The follow button on a document says what it does: email for the parcel, or only a bookmark without a cadastral id.
  const follow = d('[data-follow-box]');
  assert.equal(follow.length, 1);
  assert(follow.find('[data-follow]').attr('data-alerts') === '1' ? /^Получете имейл/.test(follow.find('[data-follow-hint]').text().trim()) : /не изпращаме известия/.test(follow.text()));
  assert.equal($('#izvestiya').length, 1, `/register/${id}/ explains the email alerts`);

  const noSlash = await get(`/register/${id}/${slug}`);
  assert.equal(noSlash.status, 301, 'Document URLs without a trailing slash redirect');
  assert.equal((await get(`/register/${id}/0-01011900/`)).status, 404);
}
assert.equal((await get('/register/unknown/')).status, 404);

// Static pages: one URL form. Slashless paths get a permanent redirect (not the asset handler's 307).
for (const path of ['/check', '/blog/kakvo-e-akt-16', '/company']) {
  const res = await get(path);
  assert.equal(res.status, 301, `${path} must 301`);
  assert.equal(new URL(res.headers.get('location'), base).pathname, `${path}/`);
  assert.equal((await get(`${path}/`)).status, 200, `${path}/`);
}
for (const path of ['/sitemap-index.xml', '/robots.txt', '/api/act16.json']) assert.equal((await get(path)).status, 200, path);
const me = await (await get('/api/auth/me/')).json();
assert('user' in me || me.error === 'accounts_unavailable');

// Interest form on /business/. Only requests that store nothing: a filled honeypot, invalid input, a foreign origin.
assert.equal((await get('/business/')).status, 200);
const lead = (body, headers = {}) => fetch(`${base}/api/business-lead/`, { method: 'POST', redirect: 'manual', headers: { origin: new URL(base).origin, ...headers }, body });
const form = (fields) => [new URLSearchParams(fields).toString(), { 'content-type': 'application/x-www-form-urlencoded' }];
const fields = { email: 'check-worker@example.com', business_type: 'broker', price_range: 'none', consent: 'on' };
const honeypot = await lead(...form({ ...fields, website: 'https://example.com' }));
assert.equal(honeypot.status, 303);
assert.equal(honeypot.headers.get('location'), '/business/#lead-ok');
const invalidForm = await lead(...form({ ...fields, consent: '' }));
assert.equal(invalidForm.headers.get('location'), '/business/#lead-invalid');
const invalidJson = await lead(JSON.stringify({ ...fields, email: 'not-an-email', consent: true }), { 'content-type': 'application/json' });
assert.equal(invalidJson.status, 400);
assert.equal((await invalidJson.json()).error, 'invalid_input');
const foreign = await lead(new URLSearchParams(fields).toString(), { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.com' });
assert.equal(foreign.status, 403);
console.log(`Worker checks passed against ${base}.`);
