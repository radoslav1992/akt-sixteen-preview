// Run after npm run build. Verify rendered HTML, not only source templates.
// Pages rendered on demand (register search, documents) are checked by scripts/check-worker.mjs.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
  assert(!url.includes('/account/'), 'Account page must not be in the sitemap');
}

const recordSlugs = { act16: new Set(), permits: new Set() };
let documents = 0;
for (const [id, key] of [['act16', 'certificates'], ['permits', 'permits']]) {
  const records = JSON.parse(readFileSync(`data/${key}.json`, 'utf8'))[key];
  assert(sitemapUrls.has(`https://akt16.org/register/${id}/`), `Sitemap missing /register/${id}/`);
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
    const slug = `${r.number}-${r.date.replace(/\./g, '')}`;
    const path = `/register/${id}/${slug}/`;
    recordSlugs[id].add(slug);
    assert(archiveLinks.has(path), `Archive missing ${path}`);
    assert(sitemapUrls.has(`https://akt16.org${path}`), `Sitemap missing ${path}`);
    documents++;
  }
}

const home = load(read('index.html'));
assert.equal(home('h1').length, 1);
assert.equal(home('form[role=search]').attr('action'), '/check/');
assert.equal(home('input[type=search]').attr('name'), 'q');
const districtLinks = new Set(home('a[href^="/region/"]').map((_, a) => home(a).attr('href')).get().filter((h) => /^\/region\/[a-z-]+\/$/.test(h)));
assert.equal(districtLinks.size, 24, 'Home links all 24 districts');
assert(home('script[type="application/ld+json"]').map((_, s) => JSON.parse(home(s).text())['@type']).get().includes('FAQPage'));

for (const slug of [...districtLinks].map((h) => h.split('/')[2])) {
  for (const id of ['act16', 'permits']) {
    const list = load(read(`region/${slug}/${id}/index.html`));
    assert.equal(list('link[rel=canonical]').attr('href'), `https://akt16.org/region/${slug}/${id}/`);
    assert.equal(list('h1').length, 1);
  }
}

for (const slug of ['kakvo-e-akt-16', 'proverka-akt-16-online', 'razreshenie-za-stroezh', 'etapi-na-stroitelstvo-akt-14-15-16']) {
  const $ = load(read(`blog/${slug}/index.html`));
  assert.equal($('h1').length, 1, slug);
  const data = $('script[type="application/ld+json"]').map((_, s) => JSON.parse($(s).text())).get();
  const post = data.find((d) => d['@type'] === 'BlogPosting');
  assert.equal(post.dateModified, '2026-10-16T00:00:00.000Z');
  assert.equal(post.mainEntityOfPage, `https://akt16.org/blog/${slug}/`);
  assert.equal($('meta[property="og:type"]').attr('content'), 'article');
}
const definition = load(read('blog/kakvo-e-akt-16/index.html'));
assert.deepEqual(definition('link[rel=alternate][hreflang]').map((_, l) => definition(l).attr('hreflang')).get().sort(), ['bg', 'en', 'ru', 'x-default']);

// Every static page: one h1, a self-referencing HTTPS canonical, a title and a description.
// Every internal link must resolve to a built file or a known on-demand route.
const onDemand = (path) => {
  const m = path.match(/^\/register\/(act16|permits)\/(?:([^/]+)\/)?$/);
  return !!m && (!m[2] || recordSlugs[m[1]].has(m[2]));
};
const exists = (path) => {
  const clean = decodeURIComponent(path.split(/[?#]/)[0]);
  if (onDemand(clean)) return true;
  const target = join(dir, clean);
  return (existsSync(target) && statSync(target).isFile()) || existsSync(join(target, 'index.html'));
};
const htmlFiles = [];
const walk = (d) => readdirSync(join(dir, d), { withFileTypes: true }).forEach((e) => {
  const p = join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (e.name === 'index.html') htmlFiles.push(p);
});
walk('');
const broken = new Map();
for (const file of htmlFiles) {
  const $ = load(read(file));
  const path = '/' + file.replace(/index\.html$/, '');
  assert.equal($('h1').length, 1, `${path} must have exactly one h1`);
  assert($('title').text().length > 10, `${path} needs a title`);
  assert(($('meta[name=description]').attr('content') ?? '').length > 40, `${path} needs a description`);
  if (path !== '/404/') assert.equal($('link[rel=canonical]').attr('href'), `https://akt16.org${path}`, `${path} canonical`);
  $('a[href^="/"]').each((_, a) => {
    const href = $(a).attr('href');
    if (href.startsWith('//')) return;
    assert(!/[?&]region=/.test(href), `${path} links to a legacy filter URL ${href}`);
    if (!exists(href)) broken.set(href, path);
  });
}
assert.equal(broken.size, 0, `Broken internal links: ${[...broken].slice(0, 10).map(([h, p]) => `${h} (on ${p})`).join(', ')}`);

assert(read('robots.txt').includes('Sitemap: https://akt16.org/sitemap-index.xml'));
console.log(`SEO checks passed: ${documents} records linked in archives and sitemap; ${htmlFiles.length} static pages with one h1, canonical and description; no broken internal links; 24 districts with crawlable register lists.`);
