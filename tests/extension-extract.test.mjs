// Browser extension: listing detection and extraction on realistic listing-page fixtures.
// extract.js works on plain strings; snapshot() below mirrors what content.js reads from the DOM.
import { beforeAll, describe, expect, it } from "vitest";
import { load } from "cheerio";

let X;
beforeAll(async () => {
  await import("../extension/extract.js");
  X = globalThis.Akt16Extract;
});

const LOCATION = ["[itemprop=address]", "[class*=location]", "[class*=address]", "[data-testid*=location]"];
const BREADCRUMBS = ["[class*=breadcrumb]", "nav[aria-label*=breadcrumb]", "[itemtype*=BreadcrumbList]"];

function snapshot(html) {
  const $ = load(html);
  const address = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.streetAddress || node.addressLocality) {
        address.push([node.streetAddress, node.addressLocality, node.addressRegion].filter((v) => typeof v === "string").join(", "));
      }
      Object.values(node).forEach(walk);
    };
    try { walk(JSON.parse($(s).text())); } catch { /* ignore broken JSON-LD */ }
  });
  $("script, style, noscript").remove();
  // innerText puts block elements on their own lines.
  $("p, div, li, h1, h2, h3, h4, section, header, footer, tr, br, dd, dt").after("\n");
  const first = (selectors) => {
    for (const sel of selectors) {
      const t = $(sel).first().text().replace(/\s+/g, " ").trim();
      if (t) return t;
    }
    return "";
  };
  const main = $("main, article, [role=main]").first();
  return {
    title: $("title").text(),
    h1: $("h1").first().text(),
    location: first(LOCATION),
    breadcrumbs: first(BREADCRUMBS),
    address: address.join("\n"),
    description: $('meta[property="og:description"]').attr("content") || $('meta[name=description]').attr("content") || "",
    text: (main.length ? main : $("body")).text(),
  };
}

const NOW = { now: new Date("2026-10-16T12:00:00Z") };

const FIXTURES = {
  imot: {
    url: "https://www.imot.bg/obiava-1c172839405162738-prodava-dvustaen-apartament-grad-sofiya-manastirski-livadi",
    html: `<!doctype html><html lang="bg"><head>
      <title>Продава 2-СТАЕН, град София, Манастирски ливади, 72 кв.м - imot.bg</title>
      <meta name="description" content="Продава 2-СТАЕН апартамент, град София, Манастирски ливади, 72 кв.м, 189 000 EUR">
    </head><body>
      <header><a href="/">imot.bg</a><nav>Продажби Наеми Нови сгради</nav></header>
      <div class="breadcrumbs"><a href="/">Начало</a> › <a>Продажби</a> › <a>град София</a> › <a>Манастирски ливади</a></div>
      <main>
        <h1>Продава 2-СТАЕН</h1>
        <div class="advHeader"><div class="location">град София, Манастирски ливади</div><div class="price">189 000 EUR <span>(2 625 EUR/кв.м)</span></div></div>
        <ul class="adParams"><li>Площ: 72 кв.м</li><li>Етаж: 4-ти от 6</li><li>Строителство: Тухла, 2025 г.</li></ul>
        <div class="description">Нова сграда с Акт 16 от март 2025 г. на ул. Ралевица, в близост до бул. България и Южния парк.
          Южно изложение, две тераси, гараж в сградата.</div>
        <section class="similar"><h3>Подобни обяви</h3><p>Продава 2-СТАЕН, Манастирски ливади — 175 000 EUR</p><p>Продава 3-СТАЕН, Лозенец — 310 000 EUR</p></section>
      </main></body></html>`,
  },
  homes: {
    url: "https://www.homes.bg/offer/apartament-za-prodazhba/tristaen-110m2-sofiya-mladost-1/as1834567",
    html: `<html><head><title>Тристаен апартамент, 110 m², Младост 1, София | Homes.bg</title>
      <meta property="og:description" content="Тристаен апартамент за продажба в Младост 1, София — 265 000 €"></head>
      <body><div id="app">
        <h1>Тристаен апартамент, 110m²</h1>
        <div class="offer-location">Младост 1, София</div>
        <div class="offer-price">265 000 €</div>
        <p>ж.к. Младост 1, ул. Александър Пушкин 12. Сградата е в строеж, Акт 16 се очаква през декември 2026 г.</p>
        <p>Етаж 5 от 8, ново строителство, ТЕЦ, асансьор.</p>
      </div></body></html>`,
  },
  imotiNet: {
    url: "https://www.imoti.net/bg/obiava/prodava-tristaen-sofiya-lozenets/9876543/",
    html: `<html><head><title>Продава Тристаен апартамент София, Лозенец - Imoti.net</title></head>
      <body><article>
        <h1>Продава Тристаен апартамент София, Лозенец</h1>
        <span class="location">гр. София, кв. Лозенец</span>
        <ul><li>Цена: 320 000 €</li><li>Площ: 95 кв.м</li></ul>
        <p>Идентификатор по КККР: 68134.902.873.1.12. Сградата е с Акт 15, предстои Акт 16 през пролетта.</p>
      </article></body></html>`,
  },
  agency: {
    url: "https://www.yavlena.com/bg/property/204512",
    html: `<html><head><title>Многостаен апартамент под наем — Явлена</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Residence","name":"Многостаен апартамент",
        "address":{"@type":"PostalAddress","streetAddress":"ул. Кутловица","addressLocality":"София","addressRegion":"Подуяне"}}</script></head>
      <body><main>
        <h1>Многостаен апартамент под наем</h1>
        <p>Наем: 1 450 € на месец</p><p>Площ 140 м2, обзаведен</p>
        <p>Сградата е въведена в експлоатация — има разрешение за ползване от ДНСК.</p>
      </main></body></html>`,
  },
  olx: {
    url: "https://www.olx.bg/d/ad/prodavam-dvustaen-apartament-v-mladost-4-CID368-ID9abcd.html",
    html: `<html><head><title>Продавам двустаен апартамент в Младост 4 - Апартаменти - OLX.bg</title></head>
      <body><div data-testid="main">
        <h1>Продавам двустаен апартамент в Младост 4</h1>
        <h3>165 000 €</h3>
        <div data-testid="location-date">София, Младост 4 - Публикувана днес</div>
        <div>Описание: Апартамент 68 кв.м., ЖК Младост 4, в близост до метростанция. Сграда с Акт 16 (2022).</div>
      </div></body></html>`,
  },
  capsAlo: {
    url: "https://www.alo.bg/8765432",
    html: `<html><head><title>ПРОДАВА ТРИСТАЕН - alo.bg</title></head><body><main>
      <h1>ПРОДАВА ТРИСТАЕН</h1>
      <p>СОФИЯ, РЕДУТА</p>
      <p>ЦЕНА 210000 ЕВРО, 88 КВ.М, УЛ. КУТЛОВИЦА, ГРУБ СТРОЕЖ</p>
    </main></body></html>`,
  },
};

const NOT_LISTINGS = {
  search: {
    url: "https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/manastirski-livadi/dvustaini",
    html: `<html><head><title>Обяви за продажба на двустайни апартаменти в София, Манастирски ливади</title></head><body><main>
      <h1>Обяви за продажба на апартаменти в София, Манастирски ливади</h1>
      ${Array.from({ length: 20 }, (_, i) => `<div class="item"><a>Продава 2-СТАЕН</a> ${70 + i} кв.м — ${150 + i} 000 EUR</div>`).join("")}
    </main></body></html>`,
  },
  home: {
    url: "https://www.homes.bg/",
    html: `<html><head><title>Homes.bg — имоти в София</title></head><body><h1>Намерете своя дом</h1><p>Апартаменти в София от 80 000 €, 60 кв.м</p></body></html>`,
  },
  plovdiv: {
    url: "https://www.imot.bg/obiava-1c171234567890123-prodava-dvustaen-apartament-grad-plovdiv-karshiyaka",
    html: `<html><head><title>Продава 2-СТАЕН, град Пловдив, Кършияка - imot.bg</title></head><body><main>
      <h1>Продава 2-СТАЕН</h1><div class="location">град Пловдив, Кършияка</div><p>Цена 120 000 EUR, 65 кв.м, Акт 16.</p>
    </main></body></html>`,
  },
  article: {
    url: "https://www.imoti.net/bg/novini/ceni-sofia-2026",
    html: `<html><head><title>Цените на апартаментите в София растат с 12%</title></head><body><article>
      <h1>Цените на апартаментите в София растат с 12%</h1>
      <p>Средната цена на квадратен метър в София вече е 2 300 € за 70 кв.м жилище.</p>
    </article></body></html>`,
  },
};

describe("listing detection", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`recognizes the ${name} listing`, () => {
      expect(X.isListingPage(snapshot(f.html), f.url)).toBe(true);
    });
  }
  for (const [name, f] of Object.entries(NOT_LISTINGS)) {
    it(`ignores the ${name} page`, () => {
      expect(X.isListingPage(snapshot(f.html), f.url)).toBe(false);
    });
  }
  it("never runs without a URL or on non-web pages", () => {
    expect(X.isListingPage(snapshot(FIXTURES.imot.html), "")).toBe(false);
    expect(X.isListingPage(snapshot(FIXTURES.imot.html), "file:///tmp/listing.html")).toBe(false);
  });
});

describe("extraction", () => {
  it("reads an imot.bg-style listing", () => {
    const ex = X.extract(snapshot(FIXTURES.imot.html), FIXTURES.imot.url, NOW);
    expect(ex.site).toBe("imot.bg");
    expect(ex.city).toBe("София");
    expect(ex.title).toBe("Продава 2-СТАЕН");
    expect(ex.location).toBe("град София, Манастирски ливади");
    expect(ex.neighborhood).toBe("Манастирски ливади");
    expect(ex.streets).toEqual(["ул. Ралевица", "бул. България"]);
    expect(ex.cadastralIds).toEqual([]);
    expect(ex.claims).toEqual([{ id: "act16", label: "Акт 16", planned: false }]);
    expect(X.toLookupParams(ex)).toEqual({ hood: "Манастирски ливади", street: "ул. Ралевица" });
  });

  it("reads a homes.bg-style listing with the place before the city", () => {
    const ex = X.extract(snapshot(FIXTURES.homes.html), FIXTURES.homes.url, NOW);
    expect(ex.neighborhood).toBe("Младост 1");
    expect(ex.streets).toEqual(["ул. Александър Пушкин"]);
    expect(ex.claims.map((c) => [c.id, c.planned])).toEqual([["act16", true], ["construction", false]]);
  });

  it("finds cadastral ids and a mix of claims", () => {
    const ex = X.extract(snapshot(FIXTURES.imotiNet.html), FIXTURES.imotiNet.url, NOW);
    expect(ex.neighborhood).toBe("Лозенец");
    expect(ex.cadastralIds).toEqual(["68134.902.873.1.12"]);
    expect(ex.claims.map((c) => c.id)).toEqual(["act16", "act15"]);
    expect(ex.claims[0].planned).toBe(true);
    expect(X.toLookupParams(ex)).toEqual({ cad: "68134.902.873.1.12", hood: "Лозенец" });
  });

  it("uses structured data (JSON-LD) on agency pages", () => {
    const ex = X.extract(snapshot(FIXTURES.agency.html), FIXTURES.agency.url, NOW);
    expect(ex.neighborhood).toBe("Подуяне");
    expect(ex.streets).toEqual(["ул. Кутловица"]);
    expect(ex.claims.map((c) => c.id)).toEqual(["use-permit"]);
  });

  it("reads an olx.bg-style listing and ignores trailing text after the place", () => {
    const ex = X.extract(snapshot(FIXTURES.olx.html), FIXTURES.olx.url, NOW);
    expect(ex.neighborhood).toBe("Младост 4");
    expect(ex.claims).toEqual([{ id: "act16", label: "Акт 16", planned: false }]);
  });

  it("copes with ALL-CAPS listings", () => {
    const ex = X.extract(snapshot(FIXTURES.capsAlo.html), FIXTURES.capsAlo.url, NOW);
    expect(ex.neighborhood).toBe("РЕДУТА");
    expect(ex.streets).toEqual(["ул. КУТЛОВИЦА"]);
    expect(ex.claims.map((c) => c.id)).toEqual(["construction"]);
  });

  it("returns nothing to look up when the page has no place", () => {
    const ex = X.extract({ title: "Продава двустаен", text: "Цена 100 000 €" }, "https://www.alo.bg/1234567", NOW);
    expect(ex.neighborhood).toBeNull();
    expect(X.toLookupParams(ex)).toEqual({});
  });

  it("keeps lookup parameters short", () => {
    const params = X.toLookupParams({ neighborhood: "А".repeat(500), streets: [], cadastralIds: [] });
    expect(params.hood.length).toBe(120);
  });
});
