import { describe, expect, it } from "vitest";
import { breadcrumbs, canonicalUrl, jsonLd } from "../src/lib/seo";

describe("search metadata", () => {
  it("consolidates query strings and slash variants on the HTTPS page", () => {
    expect(canonicalUrl("/register/act16?q=68134&region=Младост#results"))
      .toBe("https://akt16.org/register/act16/");
    expect(canonicalUrl("/register/act16/1014-14092026/"))
      .toBe("https://akt16.org/register/act16/1014-14092026/");
    expect(canonicalUrl("/")).toBe("https://akt16.org/");
  });

  it("keeps scraped descriptions from terminating a structured-data script", () => {
    const data = { name: '</script><script>alert("test")</script>', text: "София" };
    expect(jsonLd(data)).not.toContain("<");
    expect(JSON.parse(jsonLd(data))).toEqual(data);
  });

  it("gives breadcrumb items ordered, absolute canonical URLs", () => {
    const data = breadcrumbs([{ name: "Начало", path: "/" }, { name: "Акт 16", path: "/register/act16" }]);
    expect(data.itemListElement.map((item) => [item.position, item.item])).toEqual([
      [1, "https://akt16.org/"], [2, "https://akt16.org/register/act16/"],
    ]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { REGISTER_PAGE_COPY, trailingSlashRedirect } from "../src/lib/seo";

const frontmatter = (slug: string) => {
  const text = readFileSync(new URL(`../src/content/blog/${slug}.md`, import.meta.url), "utf8");
  const head = text.split(/^---$/m)[1];
  const field = (name: string) => head.match(new RegExp(`^${name}: "(.*)"$`, "m"))?.[1];
  return { title: field("title")!, seoTitle: field("seoTitle"), description: field("description")! };
};

describe("Act 16 explainer titles", () => {
  const pages = [
    { name: "/blog/kakvo-e-akt-16/", ...(() => { const f = frontmatter("kakvo-e-akt-16"); return { title: f.seoTitle ?? `${f.title} | Акт 16`, description: f.description }; })() },
    { name: "/blog/razreshenie-za-stroezh/", ...(() => { const f = frontmatter("razreshenie-za-stroezh"); return { title: f.seoTitle ?? `${f.title} | Акт 16`, description: f.description }; })() },
    { name: "/register/act16/", title: REGISTER_PAGE_COPY.act16.title, description: REGISTER_PAGE_COPY.act16.description },
  ];
  it.each(pages)("$name has a short title and a 120–155 character description", ({ title, description }) => {
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(155);
  });

  it("keeps the phrase people search for in the title", () => {
    expect(pages[0].title).toMatch(/Акт 16/);
    expect(pages[0].title).toMatch(/означава/);
    expect(pages[1].title).toMatch(/^Разрешение за строеж/);
    expect(pages[2].title).toMatch(/^Акт 16 регистър/);
  });

  it("keeps the home page (ranks for „акт 16“) aligned with the phrase in title and H1", () => {
    const home = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
    expect(home).toMatch(/title="Акт 16 — /);
    expect(home).toMatch(/<h1>Акт 16 — /);
  });
});

describe("trailing-slash redirects", () => {
  const go = (url: string, method = "GET") => trailingSlashRedirect(new Request(url, { method }));
  it("301s slashless page paths to the slash form on https", () => {
    const res = go("http://akt16.org/check?q=1");
    expect(res?.status).toBe(301);
    expect(res?.headers.get("Location")).toBe("https://akt16.org/check/?q=1");
    expect(go("https://akt16.org/company/sm-kontrol-eood")?.headers.get("Location")).toBe("https://akt16.org/company/sm-kontrol-eood/");
  });
  it("leaves slash URLs, files and non-GET requests alone", () => {
    for (const url of ["https://akt16.org/", "https://akt16.org/check/", "https://akt16.org/sitemap-index.xml", "https://akt16.org/api/act16.json", "https://akt16.org/cdn-cgi/trace"]) expect(go(url)).toBeNull();
    expect(go("https://akt16.org/api/auth/login", "POST")).toBeNull();
  });
});

describe("guides for Google's follow-up searches on „акт 16“", () => {
  const blogDir = new URL("../src/content/blog/", import.meta.url);
  const slugs = readdirSync(blogDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
  const source = (slug: string) => readFileSync(new URL(`${slug}.md`, blogDir), "utf8");
  const pageTitle = (slug: string) => { const f = frontmatter(slug); return f.seoTitle ?? `${f.title} | Акт 16`; };
  // New guides (November 2026) and the guides expanded for the same searches.
  const guides = [
    { slug: "akt-16-za-garazh", phrase: /^Акт 16 за гараж/ },
    { slug: "kashta-bez-akt-16", phrase: /^Къща без Акт 16/ },
    { slug: "kopie-na-akt-16", phrase: /^Копие на Акт 16/ },
    { slug: "iziskvaniya-za-akt-16", phrase: /^Изисквания за Акт 16/ },
    { slug: "kakvo-e-akt-16", phrase: /кой го издава/ },
    { slug: "etapi-na-stroitelstvo-akt-14-15-16", phrase: /Акт 15 и Акт 16/ },
    { slug: "proverka-akt-16-online", phrase: /^Проверка за Акт 16/ },
  ];

  it.each(guides)("$slug has a ≤ 60-character title, a 120–155-character description and the searched phrase in its H1", ({ slug, phrase }) => {
    const f = frontmatter(slug);
    expect(pageTitle(slug).length).toBeLessThanOrEqual(60);
    expect(f.description.length).toBeGreaterThanOrEqual(120);
    expect(f.description.length).toBeLessThanOrEqual(155);
    expect(f.title).toMatch(phrase);
  });

  it.each(guides)("$slug has 3–5 FAQ entries and links the register, the property check and the map", ({ slug }) => {
    const text = source(slug);
    const head = text.split(/^---$/m)[1];
    const faq = head.match(/^  - q: /gm) ?? [];
    expect(faq.length).toBeGreaterThanOrEqual(3);
    expect(faq.length).toBeLessThanOrEqual(5);
    for (const href of ["/register/act16/", "/check/", "/map/"]) expect(text).toContain(`](${href}`);
  });

  it("gives every guide a unique title and search title", () => {
    const titles = slugs.map(pageTitle);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(slugs.map((s) => frontmatter(s).title)).size).toBe(slugs.length);
  });

  it("links between guides resolve to existing posts and anchors", () => {
    const anchors = (slug: string) => new Set([...source(slug).matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]));
    for (const slug of slugs) {
      for (const [, target, hash] of source(slug).matchAll(/\]\(\/blog\/([^/)#]+)\/(?:#([^)]+))?\)/g)) {
        expect(slugs, `${slug} → ${target}`).toContain(target);
        if (hash) expect([...anchors(target)], `${slug} → ${target}#${hash}`).toContain(hash);
      }
    }
    expect(anchors("kakvo-e-akt-16")).toContain("koy-izdava");
  });

  it("links each new guide from at least two other guides", () => {
    for (const slug of ["akt-16-za-garazh", "kashta-bez-akt-16", "kopie-na-akt-16", "iziskvaniya-za-akt-16"]) {
      const linking = slugs.filter((s) => s !== slug && source(s).includes(`](/blog/${slug}/`));
      expect(linking.length, slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("lists the new guides in llms.txt", () => {
    const llms = readFileSync(new URL("../src/pages/llms.txt.ts", import.meta.url), "utf8");
    for (const slug of ["akt-16-za-garazh", "kashta-bez-akt-16", "kopie-na-akt-16", "iziskvaniya-za-akt-16"]) {
      expect(llms).toContain(`https://akt16.org/blog/${slug}/`);
    }
  });
});
