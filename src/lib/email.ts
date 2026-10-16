// Transactional email through Cloudflare Email Service (`send_email` binding named EMAIL).
// Templates are table-based HTML with inline styles so they render in Gmail, Outlook and Apple Mail.
import { SITE_URL } from "./seo";

export interface MailEnv {
  EMAIL?: { send(message: Record<string, unknown>): Promise<{ messageId: string } | void> };
  EMAIL_FROM?: string;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export type SendResult = { ok: true; id: string } | { ok: false; code: string; message: string };

const FROM_NAME = "Акт 16 Тракер";
const REPLY_TO = "info@akt16.org";

/** Errors meaning the sending domain is not set up: retrying other recipients will not help. */
export const FATAL_SEND_ERRORS = new Set(["E_SENDER_NOT_VERIFIED", "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_DAILY_LIMIT_EXCEEDED"]);

export async function sendMail(env: MailEnv, mail: Mail): Promise<SendResult> {
  if (!env.EMAIL) return { ok: false, code: "E_NO_BINDING", message: "EMAIL binding is not configured" };
  try {
    const result = await env.EMAIL.send({
      from: { email: env.EMAIL_FROM || "noreply@akt16.org", name: FROM_NAME },
      to: mail.to,
      replyTo: REPLY_TO,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.headers ? { headers: mail.headers } : {}),
    });
    // Local development (wrangler dev) simulates the binding and returns no message id.
    return { ok: true, id: result?.messageId ?? "local" };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error("[email]", e.code, e.message);
    return { ok: false, code: e.code ?? "E_UNKNOWN", message: e.message ?? String(err) };
  }
}

/* Templates */

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const C = { asphalt: "#121418", yellow: "#ffc21a", ink: "#15171b", muted: "#5b636f", line: "#e1ddd3", bg: "#f3f1eb", act16: "#0b8770", permits: "#e8590c" };

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:${C.yellow};border-radius:8px;border:2px solid ${C.asphalt}">
<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font:700 15px/1.2 Arial,Helvetica,sans-serif;color:${C.asphalt};text-decoration:none;text-transform:uppercase;letter-spacing:.04em">${esc(label)}</a>
</td></tr></table>`;
}

export function layout(opts: { preheader: string; heading: string; body: string; footer?: string }): string {
  return `<!doctype html>
<html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:${C.yellow};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="background:${C.asphalt};padding:18px 24px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:${C.yellow};color:${C.asphalt};font:900 18px/1 Arial,Helvetica,sans-serif;padding:9px 8px;border-radius:6px">16</td>
<td style="padding-left:12px;font:800 18px/1.1 Arial,Helvetica,sans-serif;color:#ffffff;text-transform:uppercase;letter-spacing:.03em">Акт 16 Тракер<br><span style="font:600 11px/1.6 Arial,Helvetica,sans-serif;color:#a3aab5;letter-spacing:.14em">AKT16.ORG · СОФИЯ</span></td>
</tr></table></td></tr>
<tr><td style="padding:28px 24px 8px;font:400 16px/1.6 Arial,Helvetica,sans-serif;color:${C.ink}">
<h1 style="margin:0 0 16px;font:800 24px/1.2 Arial,Helvetica,sans-serif;color:${C.ink}">${esc(opts.heading)}</h1>
${opts.body}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${C.line};font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.muted}">
${opts.footer ?? ""}
Акт 16 Тракер е независим информационен сайт с данни от публичните регистри на НАГ — Столична община.<br>
<a href="${SITE_URL}/" style="color:${C.muted}">akt16.org</a> · <a href="${SITE_URL}/privacy/" style="color:${C.muted}">Поверителност</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function verifyEmail(token: string): Omit<Mail, "to"> {
  const url = `${SITE_URL}/account/verify/?token=${encodeURIComponent(token)}`;
  return {
    subject: "Потвърдете имейла си в Акт 16 Тракер",
    html: layout({
      preheader: "Потвърдете адреса, за да получавате известия за следените обекти.",
      heading: "Потвърдете имейл адреса си",
      body: `<p style="margin:0 0 12px">Благодарим, че създадохте профил. Потвърдете адреса, за да получавате известия за нови документи по следените от вас райони, квартали, фирми и имоти.</p>
${button(url, "Потвърди имейла")}
<p style="margin:0 0 12px;color:${C.muted};font-size:14px">Връзката е валидна 3 дни. Ако не сте създавали профил, просто игнорирайте това писмо.</p>`,
    }),
    text: `Потвърдете имейл адреса си в Акт 16 Тракер:\n${url}\n\nВръзката е валидна 3 дни. Ако не сте създавали профил, игнорирайте това писмо.`,
  };
}

export function resetEmail(token: string): Omit<Mail, "to"> {
  const url = `${SITE_URL}/account/reset/?token=${encodeURIComponent(token)}`;
  return {
    subject: "Нова парола за Акт 16 Тракер",
    html: layout({
      preheader: "Задайте нова парола за профила си.",
      heading: "Задайте нова парола",
      body: `<p style="margin:0 0 12px">Получихме заявка за нова парола за профила ви в Акт 16 Тракер.</p>
${button(url, "Задай нова парола")}
<p style="margin:0 0 12px;color:${C.muted};font-size:14px">Връзката е валидна 1 час и може да се използва веднъж. Ако не сте поискали нова парола, игнорирайте това писмо — паролата ви остава същата.</p>`,
    }),
    text: `Задайте нова парола за Акт 16 Тракер:\n${url}\n\nВръзката е валидна 1 час. Ако не сте поискали нова парола, игнорирайте това писмо.`,
  };
}

export interface DigestDoc { register: "act16" | "permits"; number: string; date: string; title: string; url: string; region: string }
export interface DigestGroup { label: string; url: string; docs: DigestDoc[] }

export function digestEmail(opts: { name: string | null; groups: DigestGroup[]; total: number; unsubscribeUrl: string; test?: boolean }): Omit<Mail, "to"> {
  const kind = (d: DigestDoc) => (d.register === "act16" ? "Акт 16" : "Разрешение за строеж");
  const color = (d: DigestDoc) => (d.register === "act16" ? C.act16 : C.permits);
  const groupsHtml = opts.groups.map((g) => `
<h2 style="margin:24px 0 8px;font:800 17px/1.3 Arial,Helvetica,sans-serif"><a href="${esc(g.url)}" style="color:${C.ink};text-decoration:none">${esc(g.label)}</a> <span style="color:${C.muted};font-weight:600">· ${g.docs.length}</span></h2>
${g.docs.map((d) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid ${C.line};border-left:5px solid ${color(d)};border-radius:8px"><tr><td style="padding:10px 12px;font:400 14px/1.45 Arial,Helvetica,sans-serif;color:${C.ink}">
<a href="${esc(d.url)}" style="color:${C.ink};font-weight:700;text-decoration:none">${esc(kind(d))} № ${esc(d.number)}</a> <span style="color:${C.muted}">· ${esc(d.date)}${d.region ? ` · ${esc(d.region)}` : ""}</span><br>${esc(d.title)}
</td></tr></table>`).join("")}`).join("");
  const greeting = opts.name ? `Здравейте, ${esc(opts.name)}!` : "Здравейте!";
  const intro = opts.test
    ? "Това е тестово известие. Така ще изглеждат писмата, когато в регистрите се появят нови документи по следените от вас обекти."
    : `В регистрите на НАГ има ${opts.total === 1 ? "1 нов документ" : `${opts.total} нови документа`} по следените от вас обекти.`;
  const subject = opts.test
    ? "Тестово известие от Акт 16 Тракер"
    : `${opts.total === 1 ? "1 нов документ" : `${opts.total} нови документа`}: ${opts.groups.map((g) => g.label).slice(0, 2).join(", ")}`;
  const textGroups = opts.groups
    .map((g) => `${g.label}\n${g.docs.map((d) => `- ${kind(d)} № ${d.number} от ${d.date}${d.region ? `, ${d.region}` : ""}: ${d.title}\n  ${d.url}`).join("\n")}`)
    .join("\n\n");
  return {
    subject: subject.slice(0, 140),
    html: layout({
      preheader: intro,
      heading: opts.test ? "Тестово известие" : "Нови документи по следените обекти",
      body: `<p style="margin:0 0 8px">${greeting}</p><p style="margin:0 0 8px">${esc(intro)}</p>${groupsHtml}
${button(`${SITE_URL}/account/`, "Всички следени обекти")}
<p style="margin:0 0 12px;color:${C.muted};font-size:13px">Сверете данните с официалния регистър на НАГ. Липсата на документ в сайта не доказва, че такъв не е издаден.</p>`,
      footer: `Получавате това писмо, защото сте включили известията в профила си. <a href="${esc(opts.unsubscribeUrl)}" style="color:${C.muted}">Спрете известията</a> · <a href="${SITE_URL}/account/" style="color:${C.muted}">Настройки</a><br><br>`,
    }),
    text: `${greeting}\n\n${intro}\n\n${textGroups}\n\nВсички следени обекти: ${SITE_URL}/account/\nСпрете известията: ${opts.unsubscribeUrl}`,
    headers: {
      "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
