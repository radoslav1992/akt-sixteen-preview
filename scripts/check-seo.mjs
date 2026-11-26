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

// Current modification dates of the core guides: update them together with the articles' updatedDate.
const coreGuides = {
  'kakvo-e-akt-16': '2026-11-25',
  'proverka-akt-16-online': '2026-11-25',
  'razreshenie-za-stroezh': '2026-10-16',
  'etapi-na-stroitelstvo-akt-14-15-16': '2026-11-25',
};
for (const [slug, modified] of Object.entries(coreGuides)) {
  const $ = load(read(`blog/${slug}/index.html`));
  assert.equal($('h1').length, 1, slug);
  const data = $('script[type="application/ld+json"]').map((_, s) => JSON.parse($(s).text())).get();
  const post = data.find((d) => d['@type'] === 'BlogPosting');
  assert.equal(post.dateModified, `${modified}T00:00:00.000Z`, slug);
  assert.equal(post.mainEntityOfPage, `https://akt16.org/blog/${slug}/`);
  assert.equal($('meta[property="og:type"]').attr('content'), 'article');
}
const definition = load(read('blog/kakvo-e-akt-16/index.html'));
assert.deepEqual(definition('link[rel=alternate][hreflang]').map((_, l) => definition(l).attr('hreflang')).get().sort(), ['bg', 'en', 'ru', 'x-default']);
assert.equal(definition('h2#koy-izdava').length, 1, 'The definition guide keeps the #koy-izdava anchor');

// Guides for Google's follow-up searches on „акт 16“ (November 2026): built, in the sitemap, FAQPage data,
// listed on the blog index and in llms.txt.
const blogIndex = read('blog/index.html');
const llms = read('llms.txt');
for (const slug of ['akt-16-za-garazh', 'kashta-bez-akt-16', 'kopie-na-akt-16', 'iziskvaniya-za-akt-16']) {
  const url = `https://akt16.org/blog/${slug}/`;
  assert(sitemapUrls.has(url), `Sitemap missing ${url}`);
  const $ = load(read(`blog/${slug}/index.html`));
  assert.equal($('h1').length, 1, slug);
  const types = $('script[type="application/ld+json"]').map((_, s) => JSON.parse($(s).text())['@type']).get();
  assert(types.includes('BlogPosting') && types.includes('FAQPage'), `${slug} structured data`);
  assert(blogIndex.includes(`href="/blog/${slug}/"`), `Blog index missing ${slug}`);
  assert(llms.includes(url), `llms.txt missing ${slug}`);
}

// Email alerts: wherever a follow button is built, it says that it sends email and what for.
const firstPage = (section) => `${section}/${readdirSync(join(dir, section), { withFileTypes: true }).find((e) => e.isDirectory() && existsSync(join(dir, section, e.name, 'index.html'))).name}/index.html`;
for (const [file, phrase] of [[firstPage('region'), 'в района'], [firstPage('neighborhood'), 'тук'], [firstPage('company'), 'с тази фирма']]) {
  const $ = load(read(file));
  const box = $('[data-follow-box]');
  assert.equal(box.length, 1, `${file} follow button`);
  assert.equal(box.find('[data-follow-text]').text(), 'Извести ме по имейл', file);
  const hint = box.find('[data-follow-hint]').text();
  assert(hint.startsWith('Получете имейл, когато') && hint.includes(phrase) && hint.endsWith('Безплатно.'), `${file} follow hint: ${hint}`);
}
const check = load(read('check/index.html'));
assert.equal(check('#check-follow [data-follow-text]').text(), 'Извести ме за това търсене');
assert(check('#check-follow-hint').text().startsWith('Получете имейл'));
assert.equal(home('#izvestiya').length, 1, 'Home explains the email alerts');
for (const phrase of ['Едно писмо на ден', 'Безплатно', 'Отписване с един клик']) assert(home('#izvestiya').text().includes(phrase), `Home alerts explainer: ${phrase}`);
assert(home('a[href="#izvestiya"]').length > 0, 'Home links to the alerts explainer');
const account = load(read('account/index.html'));
assert(account('.auth__legal a[href="/privacy/"]').length === 1 && /имейла/.test(account('.auth__legal').text()), 'Registration says what is stored and links the privacy page');

// „За бизнеса“: built, indexable, in the sitemap, linked from the footer and from /data/, with the interest form.
const business = load(read('business/index.html'));
assert(sitemapUrls.has('https://akt16.org/business/'), 'Sitemap missing /business/');
const businessTitle = [...business('title').text()].length;
const businessDescription = [...(business('meta[name=description]').attr('content') ?? '')].length;
assert(businessTitle > 10 && businessTitle <= 60, `/business/ title is ${businessTitle} characters`);
assert(businessDescription >= 120 && businessDescription <= 155, `/business/ description is ${businessDescription} characters`);
assert(business('main').text().includes('Планирано — още не е достъпно'), '/business/ must say the plan is not available yet');
const leadForm = business('form#lead-form');
assert.equal(leadForm.attr('action'), '/api/business-lead/');
assert.equal(leadForm.attr('method'), 'post');
for (const name of ['email', 'company', 'business_type', 'interests', 'districts', 'price_range', 'consent', 'website']) assert(leadForm.find(`[name=${name}]`).length, `/business/ form field ${name}`);
assert.equal(leadForm.find('input[name=consent]').attr('checked'), undefined, 'Consent must not be pre-ticked');
assert(home('footer a[href="/business/"]').length === 1, 'Footer links /business/');
assert(load(read('data/index.html'))('main a[href="/business/"]').length === 1, '/data/ links /business/');
const privacy = load(read('privacy/index.html'));
assert.equal(privacy('h2#biznes-forma').length, 1, 'Privacy page covers the business form');
assert(/12 месеца/.test(privacy('h2#biznes-forma').nextUntil('h2').text()), 'Privacy page states the 12-month retention');

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
const slashless = new Map();
const noindexed = [];
for (const file of htmlFiles) {
  const $ = load(read(file));
  const path = '/' + file.replace(/index\.html$/, '');
  const robots = $('meta[name=robots]').attr('content');
  if (robots) {
    assert.equal(robots, 'noindex, follow', `${path} robots`);
    noindexed.push(path);
    assert(!sitemapUrls.has(`https://akt16.org${path}`), `${path} is noindex but listed in the sitemap`);
  } else if (/^\/company\/[^/]+\/$/.test(path)) {
    assert(sitemapUrls.has(`https://akt16.org${path}`), `Indexable company page ${path} missing from the sitemap`);
  }
  assert.equal($('h1').length, 1, `${path} must have exactly one h1`);
  assert($('title').text().length > 10, `${path} needs a title`);
  assert(($('meta[name=description]').attr('content') ?? '').length > 40, `${path} needs a description`);
  if (path !== '/404/') assert.equal($('link[rel=canonical]').attr('href'), `https://akt16.org${path}`, `${path} canonical`);
  $('a[href^="/"]').each((_, a) => {
    const href = $(a).attr('href');
    if (href.startsWith('//')) return;
    assert(!/[?&]region=/.test(href), `${path} links to a legacy filter URL ${href}`);
    const hrefPath = href.split(/[?#]/)[0];
    if (!hrefPath.endsWith('/') && !/\.[a-z0-9]+$/i.test(hrefPath)) slashless.set(href, path);
    if (!exists(href)) broken.set(href, path);
    else if (/^\/(blog\/[^/]+|privacy|business)\/#./.test(href) || /^\/#./.test(href)) {
      const [target, hash] = href.split('#');
      if (!load(read(`${target.slice(1)}index.html`))(`[id="${hash}"]`).length) broken.set(href, path);
    }
  });
}
assert.equal(slashless.size, 0, `Internal links without a trailing slash: ${[...slashless].slice(0, 10).map(([h, p]) => `${h} (on ${p})`).join(', ')}`);
const noindexCompanies = noindexed.filter((p) => p.startsWith('/company/')).length;
assert(noindexCompanies > 0, 'Expected some thin company pages to be noindexed');
for (const file of htmlFiles) assert(!/href="http:\/\//.test(read(file)), `${file} links to an http:// URL`);
assert.equal(broken.size, 0, `Broken internal links: ${[...broken].slice(0, 10).map(([h, p]) => `${h} (on ${p})`).join(', ')}`);

assert(read('robots.txt').includes('Sitemap: https://akt16.org/sitemap-index.xml'));
console.log(`SEO checks passed: /business/ (title ${businessTitle}, description ${businessDescription} characters) and alert buttons; ${sitemapUrls.size} sitemap URLs; ${noindexed.length} noindex pages (${noindexCompanies} companies), none in the sitemap; ${documents} records linked in archives and sitemap; ${htmlFiles.length} static pages with one h1, canonical and description; no broken internal links; 24 districts with crawlable register lists.`);
