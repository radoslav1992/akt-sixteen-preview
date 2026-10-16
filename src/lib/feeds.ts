// RSS 2.0 and CSV builders shared by the feed and download endpoints.
import { recordSlug, extractCadastreIds, type Record, type RegisterId } from "./data";
import { splitParties, parseCompany } from "./companies";
import { neighborhoodOf } from "./places";
import { buildingTypeLabel, classify } from "./classify";
import { isoDate, sentenceCase, truncate, dateKey } from "./format";
import { SITE_URL } from "./seo";

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export function rssFeed(opts: { title: string; description: string; path: string; items: Array<{ registerId: RegisterId; record: Record }> }): Response {
  const items = [...opts.items].sort((a, b) => dateKey(b.record.date) - dateKey(a.record.date)).slice(0, 50);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(opts.title)}</title>
<link>${SITE_URL}${opts.path}</link>
<description>${xml(opts.description)}</description>
<language>bg</language>
<atom:link href="${SITE_URL}${opts.path}rss.xml" rel="self" type="application/rss+xml"/>
${items.map(({ registerId, record: r }) => {
  const url = `${SITE_URL}/register/${registerId}/${recordSlug(r)}/`;
  const kind = registerId === "act16" ? "Акт 16" : "Разрешение за строеж";
  return `<item>
<title>${xml(`${kind} № ${r.number} от ${r.date}${r.region ? ` — ${r.region}` : ""}`)}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${new Date(isoDate(r.date) + "T09:00:00Z").toUTCString()}</pubDate>
<category>${xml(kind)}</category>
<description>${xml(truncate(sentenceCase(r.object), 400))}</description>
</item>`;
}).join("\n")}
</channel>
</rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

const cell = (v: string) => `"${(v ?? "").replace(/\s+/g, " ").replace(/"/g, '""').trim()}"`;

/** Natural persons are replaced with a placeholder in bulk exports; companies keep their names. */
function partiesForExport(value: string): string {
  return splitParties(value || "").map((p) => (parseCompany(p) ? p : "физическо лице")).join(", ");
}

export function csvExport(registerId: RegisterId, records: Record[]): Response {
  const party = registerId === "permits" ? "Възложител" : "Строителен надзор";
  const header = ["Номер", "Дата", "Вид документ", "Статус", "Издател", party, "Строеж", "Тип (автоматично)", "Район", "Квартал", "Идентификатор КККР", "Местоположение", "Линк"];
  const rows = records.map((r) => {
    const hood = neighborhoodOf(r);
    return [
      r.number, r.date, r.documentType, r.status ?? "", r.issuer,
      partiesForExport(registerId === "permits" ? r.employer : r.constructionOversight),
      r.object, buildingTypeLabel(classify(r)), r.region, hood?.name ?? "",
      extractCadastreIds(r.scope).join(" "), r.scope, `${SITE_URL}/register/${registerId}/${recordSlug(r)}/`,
    ].map(cell).join(",");
  });
  return new Response("﻿" + [header.map(cell).join(","), ...rows].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  });
}
