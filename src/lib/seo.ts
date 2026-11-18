export const SITE_URL = "https://akt16.org";

export function canonicalUrl(path: string): string {
  const url = new URL(path, SITE_URL);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url.href;
}

export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

/**
 * One URL form: every page ends in a slash. Cloudflare's asset handler answers "/check" with a
 * temporary 307, so the worker runs first for slashless paths (wrangler.jsonc → run_worker_first)
 * and answers with a permanent redirect instead, upgrading http to https on the way.
 */
export function trailingSlashRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const last = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  if (!last || last.includes(".") || url.pathname.startsWith("/cdn-cgi/")) return null;
  url.pathname += "/";
  if (url.hostname === "akt16.org") url.protocol = "https:";
  return new Response(null, { status: 301, headers: { Location: url.href } });
}

/** Title, H1 and description of the two register search pages (tested for length in tests/seo.test.ts). */
export const REGISTER_PAGE_COPY = {
  permits: {
    title: "Разрешения за строеж в София — регистър и проверка",
    heading: "Регистър на издадените разрешения за строеж в София",
    description: "Проверете разрешение за строеж (разрешително) в София по адрес, район, номер или възложител. Търсене и филтри по дата и тип сграда с данни от регистъра на НАГ.",
  },
  act16: {
    title: "Акт 16 регистър за София — търсене по адрес и номер",
    heading: "Регистър на удостоверенията за въвеждане в експлоатация (Акт 16)",
    description: "Търсете удостоверения за въвеждане в експлоатация (Акт 16) в София по адрес, район, номер или идентификатор КККР. Данни от НАГ, обновявани всеки ден.",
  },
} as const;
