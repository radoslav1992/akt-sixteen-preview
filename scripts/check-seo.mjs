// Run after npm run build. Verify rendered HTML, not only source templates.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';

const dir = 'dist/client';
const read = (path) => readFileSync(join(dir, path), 'utf8');
const sitemap = readdirSync(dir).filter((name) => /^sitemap-\d+\.xml$/.test(name)).map(read).join('');
const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const sitemapUrls = new Set(locations);
assert.equal(locations.length, sitemapUrls.size, 'Sitemap URLs must be unique');
assert(sitemapUrls.size > 0);
for (const url of sitemapUrls) {
  assert(url.startsWith('https://akt16.org/'), url);
  assert(url.endsWith('/'), url);
  assert(!url.includes('?'), url);
}

let documents = 0;
for (const [id, key] of [['act16', 'certificates'], ['permits', 'permits']]) {
  const records = JSON.parse(readFileSync(`data/${key}.json`, 'utf8'))[key];
  const $ = load(read(`register/${id}/index.html`));
  assert.equal($('#table-body tr').length, Math.min(30, records.length));
  assert.equal($('#mobile-list a').length, Math.min(30, records.length));
  assert.equal($('link[rel=canonical]').attr('href'), `https://akt16.org/register/${id}/`);
  assert($(`a[href="/register/${id}/archive/1/"]`).length);
  const archiveLinks = new Set();
  const count = Math.ceil(records.length / 100);
  for (let page = 1; page <= count; page++) {
    const archive = load(read(`register/${id}/archive/${page}/index.html`));
    assert.equal(archive('link[rel=canonical]').attr('href'), `https://akt16.org/register/${id}/archive/${page}/`);
    archive('.archive ol a').each((_, a) => archiveLinks.add(archive(a).attr('href')));
    if (page < count) assert.equal(archive('a[rel=next]').attr('href'), `/register/${id}/archive/${page + 1}/`);
    if (page > 1) assert.equal(archive('a[rel=prev]').attr('href'), `/register/${id}/archive/${page - 1}/`);
  }
  for (const r of records) {
    const path = `/register/${id}/${r.number}-${r.date.replace(/\./g, '')}/`;
    assert(archiveLinks.has(path), `Archive missing ${path}`);
    assert(sitemapUrls.has(`https://akt16.org${path}`), `Sitemap missing ${path}`);
    documents++;
  }
}

const home = load(read('index.html'));
assert.equal(home('h1').length, 1);
assert.equal(home('form[role=search]').attr('action'), '/register/act16/');
assert.equal(home('input[type=search]').attr('name'), 'q');
assert.equal(new Set(home('a[href^="/region/"]').map((_, a) => home(a).attr('href')).get()).size, 24);

for (const slug of ['kakvo-e-akt-16', 'proverka-akt-16-online', 'razreshenie-za-stroezh', 'etapi-na-stroitelstvo-akt-14-15-16']) {
  const $ = load(read(`blog/${slug}/index.html`));
  assert.equal($('h1').length, 1, slug);
  const data = $('script[type="application/ld+json"]').map((_, s) => JSON.parse($(s).text())).get();
  const post = data.find((d) => d['@type'] === 'BlogPosting');
  assert.equal(post.dateModified, '2026-09-18T00:00:00.000Z');
  assert.equal(post.mainEntityOfPage, `https://akt16.org/blog/${slug}/`);
  assert.equal($('meta[property="og:type"]').attr('content'), 'article');
}
assert(read('robots.txt').includes('Sitemap: https://akt16.org/sitemap-index.xml'));
console.log(`SEO checks passed: ${documents} records linked in archives and sitemap; 24 districts; HTML register rows; canonical URLs and article metadata.`);
