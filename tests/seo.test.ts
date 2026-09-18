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
