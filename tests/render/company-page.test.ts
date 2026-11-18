import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import CompanyPage from "../../src/pages/company/[slug].astro";
import { getListedCompanies, isCompanyIndexable } from "../../src/lib/companies";

describe("company page head", () => {
  it("renders noindex, follow below the threshold and nothing above it", async () => {
    const container = await AstroContainer.create();
    const below = getListedCompanies().find((c) => !isCompanyIndexable(c))!;
    const above = getListedCompanies().find((c) => isCompanyIndexable(c) && c.docs.length === 2)!;
    for (const [company, noindex] of [[below, true], [above, false]] as const) {
      const html = await container.renderToString(CompanyPage, { params: { slug: company.slug }, props: { company }, request: new Request(`https://akt16.org/company/${company.slug}/`) });
      expect(html).toContain(`<link rel="canonical" href="https://akt16.org/company/${company.slug}/">`);
      expect(html.includes('<meta name="robots" content="noindex, follow">'), company.slug).toBe(noindex);
    }
  });
});
