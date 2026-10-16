import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

// Link in every digest. GET shows a confirmation button (mail scanners prefetch links), POST unsubscribes.
// Mail providers' one-click unsubscribe (RFC 8058) POSTs here directly without an Origin header.

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | Акт 16</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f3f1eb;color:#15171b}main{max-width:520px;margin:10vh auto;padding:28px;background:#fff;border:1px solid #e1ddd3;border-top:6px solid #ffc21a;border-radius:12px}h1{font-size:1.5rem;margin:0 0 .6rem}button{font:700 1rem system-ui;background:#ffc21a;border:2px solid #121418;border-radius:8px;padding:.7rem 1.2rem;cursor:pointer}a{color:#1d56d1}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );

function params(url: URL) {
  const id = Number(url.searchParams.get("u"));
  const token = url.searchParams.get("t") ?? "";
  return Number.isInteger(id) && id > 0 && token.length >= 20 && token.length <= 128 ? { id, token } : null;
}

export const GET: APIRoute = ({ url }) => {
  if (!params(url)) return page("Невалидна връзка", `<p>Връзката за отписване е непълна. Можете да спрете известията от <a href="/account/">профила си</a>.</p>`, 400);
  return page(
    "Спиране на известията",
    `<p>Потвърдете, че не искате повече имейли за нови документи по следените обекти.</p>
<form method="post"><button type="submit">Спри известията</button></form>
<p style="font-size:.9rem;color:#5b636f">Списъкът ви със следени обекти остава в <a href="/account/">профила</a>.</p>`,
  );
};

export const POST: APIRoute = async ({ url }) => {
  const p = params(url);
  if (!p || !env.DB) return page("Невалидна връзка", `<p>Не успяхме да ви отпишем. Опитайте от <a href="/account/">профила си</a>.</p>`, 400);
  const { meta } = await env.DB.prepare("UPDATE users SET email_alerts = 0 WHERE id = ? AND unsubscribe_token = ?").bind(p.id, p.token).run();
  if (!meta.changes) return page("Невалидна връзка", `<p>Връзката е невалидна или профилът е изтрит. Настройките са в <a href="/account/">профила</a>.</p>`, 400);
  return page("Известията са спрени", `<p>Няма да получавате повече имейли с нови документи. Можете да ги включите отново от <a href="/account/">профила си</a> по всяко време.</p>`);
};
