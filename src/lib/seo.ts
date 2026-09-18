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
