/*
 * Акт 16 Тракер — extracts location data and claims from a property listing.
 * Classic script (no modules): runs as a content script before content.js and is loaded by the tests.
 * Works on plain strings only; content.js gathers them from the DOM:
 *   page = { title, h1, location, breadcrumbs, address, description, text }   (all optional)
 * Exposes globalThis.Akt16Extract = { isListingPage, extract, toLookupParams }.
 */
(function (root) {
  "use strict";

  // Optional per-site hints. Listing sites change their markup and URLs often, so these only nudge
  // the decision; the content heuristics below must work on their own.
  const SITES = [
    { id: "imot.bg", host: /(^|\.)imot\.bg$/i, listing: /\/obiava-|[?&]act=5(&|$)/i, search: /\/obiavi\/|[?&]act=3(&|$)/i },
    { id: "homes.bg", host: /(^|\.)homes\.bg$/i, listing: /\/offer\/|\/as\d{5,}/i, search: /\/search/i },
    { id: "imoti.net", host: /(^|\.)imoti\.net$/i, listing: /\/obiava\//i, search: /\/obiavi\//i },
    { id: "alo.bg", host: /(^|\.)alo\.bg$/i, listing: /^\/\d{6,}(\/|$)|\/obiava\//i, search: /\/obiavi\//i },
    { id: "olx.bg", host: /(^|\.)olx\.bg$/i, listing: /\/d\/ad\/|\/ad\//i, search: /\/nedvizhimi-imoti\//i },
    { id: "address.bg", host: /(^|\.)address\.bg$/i, listing: /\/offer\/|-\d{5,}\/?$/i, search: /\/search/i },
    { id: "bazar.bg", host: /(^|\.)bazar\.bg$/i, listing: /\/obiava\/\d+/i, search: /\/obiavi\//i },
    { id: "yavlena.com", host: /(^|\.)yavlena\.com$/i, listing: /\/(property|imot)\/|\/\d{5,}\/?$/i, search: /\/search/i },
    { id: "luximmo.bg", host: /(^|\.)luximmo\.bg$/i, listing: /-\d{4,}\.html$/i, search: /\/search|\/tarsene/i },
  ];

  const SOFIA = /(^|[^а-яa-z])(софия|sofia|sofiya)(?![а-яa-z])/iu;
  const DEAL = /(^|[^а-я])(продава|продавам|продажба|под наем|наем|отдава|давам|купува)(?![а-я])/iu;
  const PROPERTY = /(^|[^а-я])(апартамент|едностаен|двустаен|тристаен|четиристаен|многостаен|мезонет|студио|ателие|таван|къща|вила|етаж от къща|офис|магазин|парцел|гараж|паркомясто|стая|\d\s*-?\s*стаен)(?![а-я])/iu;
  const SEARCH_HEADING = /(^|[^а-я])(обяви|резултати|намерени|търсене)(?![а-я])/iu;
  const AREA = /\d+(?:[.,]\d+)?\s*(?:кв\.?\s*м|м2|м²|m²|m2)(?![а-я])/iu;
  const PRICE = /\d[\d\s.,]*\s*(?:€|eur(?![a-z])|евро|лв\.?|лева|bgn)|(?:€|eur)\s*\d/iu;
  const PRICES = new RegExp(PRICE.source, "giu");

  const NOT_A_PLACE = /продава|апартамент|стаен|наем|цена|кв\.?\s*м|€|лв|обяви|имоти|област|община|българия|етаж|тухла|панел|ново строителство|строителство|обзаведен|агенция|контакт/iu;
  const HOOD_MARKER = /^(?:кв\.|квартал|ж\.\s?к\.?|жк\.?|район|р-н|местност|м\.)\s*/iu;
  const STREET = /(^|[^а-яa-z])(ул\.|улица|бул\.|булевард)\s*["„“]?\s*([^\n,;()|"“”„]{2,60})/giu;
  const STREET_STOP = new Set([
    "и", "в", "във", "до", "на", "от", "за", "с", "със", "към", "близо", "близост", "метро", "срещу", "между", "зад", "пред",
    "при", "около", "след", "преди", "вх", "вход", "ет", "етаж", "бл", "блок", "ап", "кв", "ж.к", "жк", "гр", "район", "р-н", "№", "no",
  ]);
  const STREET_LOWER_OK = new Set(["шосе", "поле", "път", "връх", "река", "планина", "долина", "гора", "ливади", "бряг", "вада", "градина"]);
  const CADASTRE = /(?<![\d.])\d{5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,4}){0,2}(?!\d)/g;
  const CLAIMS = [
    { id: "act16", label: "Акт 16", re: /акт\s*(?:№|-|обр(?:азец|\.)?)?\s*16(?!\d)|удостоверение\s+за\s+въвеждане\s+в\s+експлоатация/giu },
    { id: "use-permit", label: "разрешение за ползване", re: /разрешение\s+за\s+ползване/giu },
    { id: "act15", label: "Акт 15", re: /акт\s*(?:№|-|обр(?:азец|\.)?)?\s*15(?!\d)/giu },
    { id: "act14", label: "Акт 14", re: /акт\s*(?:№|-|обр(?:азец|\.)?)?\s*14(?!\d)/giu },
    { id: "construction", label: "в строеж", re: /в\s+строеж|в\s+процес\s+на\s+строителство|в\s+етап\s+на\s+строителство|груб\s+строеж|на\s+зелено/giu },
  ];
  const PLANNED = /очаква|предстои|планиран|прогноз|до\s+края|до\s+(?:\d{1,2}[./]|януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември|q\d)/iu;
  const CLAUSE = /[,;!?\n(]|\.\s/;
  const MAX_TEXT = 40000;

  const str = (v) => (typeof v === "string" ? v : "");
  const squash = (v) => str(v).replace(/[ \s]+/g, " ").trim();

  function page(doc) {
    const d = doc || {};
    return {
      title: squash(d.title),
      h1: squash(d.h1),
      location: squash(d.location),
      breadcrumbs: squash(d.breadcrumbs),
      address: str(d.address).trim(),
      description: squash(d.description),
      text: str(d.text).slice(0, MAX_TEXT),
    };
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch (e) {
      return null;
    }
  }

  function siteFor(url) {
    const u = parseUrl(url);
    return u ? SITES.find((s) => s.host.test(u.hostname)) || null : null;
  }

  function mentionsSofia(p, url) {
    const u = parseUrl(url);
    let path = "";
    try {
      path = u ? decodeURIComponent(u.pathname + u.search) : "";
    } catch (e) {
      path = u ? u.pathname : "";
    }
    return [p.location, p.address, p.breadcrumbs, p.h1, p.title, p.description, p.text.slice(0, 3000), path].some((s) => SOFIA.test(s));
  }

  /** True only for what looks like a single property listing in Sofia — never for home or search pages. */
  function isListingPage(doc, url) {
    const p = page(doc);
    const u = parseUrl(url);
    if (!u || !/^https?:$/.test(u.protocol)) return false;
    if ((u.pathname === "/" || u.pathname === "") && !u.search) return false;
    const site = siteFor(url);
    const where = u.pathname + u.search;
    const listingUrl = !!(site && site.listing.test(where));
    if (site && site.search.test(where) && !listingUrl) return false;
    if (!mentionsSofia(p, url)) return false;

    const heading = p.h1 || p.title;
    const prices = (p.text.slice(0, 20000).match(PRICES) || []).length;
    let score = 0;
    if (listingUrl) score += 2;
    if (DEAL.test(heading) || PROPERTY.test(heading.split(/\s+/).slice(0, 5).join(" "))) score += 2;
    if (SEARCH_HEADING.test(heading)) score -= 3;
    if (AREA.test(p.text) || AREA.test(heading)) score += 1;
    if (prices > 0 || PRICE.test(heading)) score += 1;
    if (prices > 15) score -= 2;
    return score >= 3;
  }

  // " - " between phrases, but not in "Манастирски ливади – запад" or "Младост - 1".
  const PHRASE_SEP = /\s+[-–—|•·]\s+(?!(?:запад|изток|север|юг|\d+)(?![а-я\d]))/iu;
  // Where a heading moves on from the place to the listing: "Младост 1 65 кв.м", "Лозенец Цена: …".
  const PHRASE_END = /\s+(?=\d+(?:[.,]\d+)?\s*(?:кв|м2|м²|€|лв|eur)|(?:цена|продава|площ|етаж|тип|за продажба|под наем)(?![а-я]))/iu;

  function cleanHood(raw, takeLast) {
    const parts = squash(raw).replace(/[„“”"«»]/g, "").split(PHRASE_SEP);
    let s = (takeLast ? parts[parts.length - 1] : parts[0]).split(PHRASE_END)[0];
    for (let i = 0; i < 2; i++) s = s.replace(HOOD_MARKER, "");
    s = s.replace(/[.:\s]+$/, "").trim();
    if (s.length < 3 || s.length > 50) return "";
    if (/\d{3,}/.test(s) || NOT_A_PLACE.test(s) || SOFIA.test(s)) return "";
    if (s.split(/\s+/).length > 5) return "";
    if (/^[а-яa-z]/.test(s) && !/^(с\.|в\.\s?з\.)/.test(s)) return "";
    return s;
  }

  const LOCATION_PATTERNS = [
    // "град София, Манастирски ливади", "гр. София / кв. Лозенец"
    /(?:^|[^а-я])(?:град|гр\.)\s*софия(?:\s*[-–]?\s*град)?\s*[,/–-]\s*([^,\n|•·()/]{2,60})/iu,
    // "София, Младост 1", "София-град, Лозенец"
    /(?:^|[^а-я])софия(?:\s*[-–]\s*град|\s*\(столица\))?\s*[,/]\s*([^,\n|•·()/]{2,60})/iu,
  ];
  // "Младост 1, София" (the place before the city)
  const LOCATION_BEFORE = /([^,\n|•·()/]{2,60}),\s*(?:(?:град|гр\.)\s*)?софия(?![а-я])/iu;
  const EXPLICIT_HOOD = /(?:^|[^а-яА-Я])(?:кв\.|квартал|ж\.\s?к\.|жк)\s*["„]?\s*([А-Я][а-я]+(?:(?:\s*[-–]\s*|\s+)(?:[А-Я0-9][а-я0-9]*|ливади|вада|глава|долина|поле|река|баня|поляна|брези|гора|парк|град|купел|шосе|спирка|колеж|фабрика|предградие|жилища|рампа|академия|запад|изток)(?![а-я])){0,3})/u;

  function findLocation(p) {
    const heading = p.h1 || p.title;
    const sources = [p.location, p.address, heading, p.title, p.description, p.text.slice(0, 8000)];
    for (const source of sources) {
      if (!source) continue;
      for (const re of LOCATION_PATTERNS) {
        const m = source.match(re);
        const hood = m && cleanHood(m[1]);
        if (hood) return { location: squash(m[0]).replace(/^[^а-яА-Яa-zA-Z]+/, ""), hood };
      }
      const before = source.match(LOCATION_BEFORE);
      if (before) {
        const hood = cleanHood(before[1], true);
        if (hood) return { location: squash(before[0]), hood };
      }
    }
    if (p.breadcrumbs) {
      const parts = p.breadcrumbs.split(/\s*[›»>/|]\s*|\n/).map(squash).filter(Boolean);
      const i = parts.findIndex((t) => /^(?:град\s+|гр\.\s*)?софия(?:[-\s]?град)?$/iu.test(t));
      const hood = i >= 0 && parts[i + 1] ? cleanHood(parts[i + 1]) : "";
      if (hood) return { location: parts.slice(i, i + 2).join(", "), hood };
    }
    for (const source of [p.location, heading, p.description, p.text.slice(0, 8000)]) {
      const m = source && source.match(EXPLICIT_HOOD);
      const hood = m && cleanHood(m[1]);
      if (hood) return { location: squash(m[0]), hood };
    }
    return { location: p.location || "", hood: "" };
  }

  function cleanStreet(raw) {
    const words = squash(raw).split(" ");
    const out = [];
    for (const word of words) {
      const bare = word.replace(/[.:]+$/, "");
      const lower = bare.toLowerCase();
      if (!bare || STREET_STOP.has(lower) || word.startsWith("№")) break;
      if (out.length && /\d/.test(bare)) break; // house number
      if (out.length && /^[а-я]/.test(bare) && !STREET_LOWER_OK.has(lower)) break;
      // Keep the dot of an abbreviated title ("Проф. Велизар Велков").
      out.push(/^(проф|акад|д-р|ген|св|арх|инж|кап|полк)$/iu.test(bare) ? `${bare}.` : bare);
      if (out.length >= 4) break;
    }
    const name = out.join(" ");
    if (!name || !/^[А-ЯA-Z0-9]/.test(name) || !/[а-яА-Я]{2,}/.test(name)) return "";
    if (/^(проф|акад|д-р|ген|св|арх|инж|кап|полк)\.$/iu.test(name)) return "";
    return name;
  }

  function findStreets(sources) {
    const seen = new Set();
    const streets = [];
    for (const source of sources) {
      if (!source) continue;
      STREET.lastIndex = 0;
      let m;
      while ((m = STREET.exec(source)) && streets.length < 3) {
        const name = cleanStreet(m[3]);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        streets.push(`${/^бул|^булевард/iu.test(m[2]) ? "бул." : "ул."} ${name}`);
      }
    }
    return streets;
  }

  function findCadastralIds(text) {
    return [...new Set(text.match(CADASTRE) || [])].slice(0, 5);
  }

  function findClaims(text, now) {
    const year = (now || new Date()).getFullYear();
    const claims = [];
    for (const claim of CLAIMS) {
      claim.re.lastIndex = 0;
      const m = claim.re.exec(text);
      if (!m) continue;
      // The clause around the match: "предстои Акт 16", "Акт 16 до края на 2026 г."
      const before = text.slice(Math.max(0, m.index - 60), m.index).split(CLAUSE).pop();
      const after = text.slice(m.index, m.index + m[0].length + 80).split(CLAUSE)[0];
      const context = before + after;
      const years = (after.match(/20\d\d/g) || []).map(Number);
      const planned = claim.id !== "construction" && (PLANNED.test(context) || years.some((y) => y >= year));
      claims.push({ id: claim.id, label: claim.label, planned });
    }
    return claims;
  }

  /** Location, streets, cadastral ids and claims from a listing. Pure: strings in, plain object out. */
  function extract(doc, url, options) {
    const p = page(doc);
    const site = siteFor(url);
    const u = parseUrl(url);
    const heading = p.h1 || p.title;
    const found = findLocation(p);
    const all = [p.location, p.address, heading, p.description, p.text].join("\n");
    return {
      site: site ? site.id : u ? u.hostname.replace(/^www\./, "") : "",
      url: str(url),
      title: heading,
      city: mentionsSofia(p, url) ? "София" : null,
      location: found.location,
      neighborhood: found.hood || null,
      streets: findStreets([p.location, p.address, heading, p.description, p.text]),
      cadastralIds: findCadastralIds(all),
      claims: findClaims(all, options && options.now),
    };
  }

  /** Query parameters for https://akt16.org/api/lookup/ — only the place, never the listing itself. */
  function toLookupParams(extraction) {
    const params = {};
    const cut = (s) => str(s).slice(0, 120);
    if (extraction && extraction.cadastralIds && extraction.cadastralIds[0]) params.cad = cut(extraction.cadastralIds[0]);
    if (extraction && extraction.neighborhood) params.hood = cut(extraction.neighborhood);
    if (extraction && extraction.streets && extraction.streets[0]) params.street = cut(extraction.streets[0]);
    return params;
  }

  root.Akt16Extract = { isListingPage, extract, toLookupParams };
})(typeof globalThis !== "undefined" ? globalThis : this);
