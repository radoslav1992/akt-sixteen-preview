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

import { readFileSync } from "node:fs";
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
