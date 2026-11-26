import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { load } from "cheerio";
import FollowButton from "../../src/components/FollowButton.astro";
import AlertsExplainer from "../../src/components/AlertsExplainer.astro";
import BusinessPage from "../../src/pages/business.astro";
import { BUSINESS_PAGE_COPY } from "../../src/lib/business";
import { BUSINESS_TYPES, HONEYPOT_FIELD, LEAD_INTERESTS, PRICE_RANGES } from "../../src/lib/leads";

describe("follow button", () => {
  it("says it sends email and what for, for each kind of page", async () => {
    const container = await AstroContainer.create();
    for (const [kind, phrase] of [["region", "в района"], ["neighborhood", "тук"], ["company", "с тази фирма"], ["parcel", "за този имот"], ["search", "това търсене"]] as const) {
      const $ = load(await container.renderToString(FollowButton, { props: { kind, itemKey: "k", label: "Етикет", url: "/x/" } }));
      const button = $("button[data-follow]");
      expect(button.text().trim(), kind).toBe("Извести ме по имейл");
      expect(button.attr("data-kind")).toBe(kind);
      expect(button.attr("data-alerts")).toBe("1");
      const hint = $("[data-follow-hint]").text();
      expect(hint, kind).toContain(phrase);
      expect(hint).toMatch(/^Получете имейл, когато/);
      expect(hint).toMatch(/Безплатно\.$/);
      // Hidden until the script runs: following needs JavaScript.
      expect($("[data-follow-box]").attr("hidden")).toBeDefined();
    }
  });

  it("does not promise email for a document the digest cannot match", async () => {
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(FollowButton, { props: { kind: "record", alerts: false, itemKey: "act16:1-01012026", label: "Документ", url: "/x/" } }));
    expect($("button[data-follow]").text().trim()).toBe("Запази в „Следени“");
    expect($("button[data-follow]").attr("data-alerts")).toBe("0");
    expect($("[data-follow-hint]").text()).not.toMatch(/имейл/);
  });
});

describe("alerts explainer", () => {
  it("states the daily digest, that it is free and the unsubscribe link", async () => {
    const container = await AstroContainer.create();
    const text = load(await container.renderToString(AlertsExplainer))("section").text();
    for (const phrase of ["Едно писмо на ден", "Безплатно", "Отписване с един клик", "Извести ме по имейл"]) expect(text).toContain(phrase);
    expect(text).not.toMatch(/веднага|незабавно|мигновен/i);
  });
});

describe("/business/ page", () => {
  it("renders the metadata, the planned-only notice and the interest form", async () => {
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(BusinessPage, { request: new Request("https://akt16.org/business/") }));
    expect($("title").text()).toBe(BUSINESS_PAGE_COPY.title);
    expect($("meta[name=description]").attr("content")).toBe(BUSINESS_PAGE_COPY.description);
    expect($("link[rel=canonical]").attr("href")).toBe("https://akt16.org/business/");
    expect($("meta[name=robots]").length).toBe(0);
    expect($("h1").length).toBe(1);
    expect($("h1").text()).toBe(BUSINESS_PAGE_COPY.heading);

    const text = $("main").text();
    expect(text).toContain("Планирано — още не е достъпно");
    expect(text).toContain("Безплатните имейл известия остават безплатни");
    expect(text).toContain("НАГ — Столична община");
    expect(text).toContain("не е официален регистър");
    // No price is promised: the only amounts on the page are the answer options of the form's question.
    expect($("main").clone().find("select[name=price_range]").remove().end().text()).not.toMatch(/\d\s*(лв|€|евро|EUR)/i);
    expect($("select[name=price_range]").text()).toMatch(/\d\s*€/);
    expect($(".stat__value").length).toBe(4);

    const form = $("form#lead-form");
    expect([form.attr("method"), form.attr("action")]).toEqual(["post", "/api/business-lead/"]);
    expect(form.find("input[name=email]").attr("required")).toBeDefined();
    expect(form.find("input[name=company]").attr("required")).toBeUndefined();
    expect(form.find("select[name=business_type] option").map((_, o) => $(o).attr("value")).get()).toEqual(["", ...BUSINESS_TYPES.map((t) => t.id)]);
    expect(form.find("input[name=interests]").map((_, o) => $(o).attr("value")).get()).toEqual(LEAD_INTERESTS.map((i) => i.id));
    expect(form.find("select[name=price_range] option").map((_, o) => $(o).attr("value")).get()).toEqual(["", ...PRICE_RANGES.map((p) => p.id)]);
    expect(form.find("select[name=price_range]").text()).toContain("Не бих платил");
    const consent = form.find("input[name=consent]");
    expect([consent.attr("type"), consent.attr("checked"), consent.attr("required") !== undefined]).toEqual(["checkbox", undefined, true]);
    expect(consent.closest("label").find('a[href="/privacy/#biznes-forma"]').length).toBe(1);
    const honeypot = form.find(`input[name=${HONEYPOT_FIELD}]`);
    expect([honeypot.attr("tabindex"), honeypot.closest("[aria-hidden=true]").length]).toEqual(["-1", 1]);
    for (const id of ["lead-ok", "lead-invalid", "lead-limit", "lead-error"]) expect($(`#${id}.lead-result`).length, id).toBe(1);
  });
});
