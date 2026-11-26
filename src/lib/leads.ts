// Interest form on /business/ („За бизнеса“): validation, storage (D1 table business_leads, migration 0003)
// and the request handler behind POST /api/business-lead/. Nothing is sold: the answers only show
// whether a paid business plan is worth building, and whom to tell when it exists.
import { InputError, checkOrigin, checkRateLimit, fail, json, nowIso, parseEmail, recordAttempt } from "./auth";
import { CONTACT_EMAIL, esc, layout, sendMail, type Mail, type MailEnv } from "./email";

export const BUSINESS_TYPES = [
  { id: "broker", label: "Брокер или агенция за недвижими имоти" },
  { id: "credit", label: "Кредитен посредник" },
  { id: "utilities", label: "Интернет, телевизия или комунални услуги" },
  { id: "furniture", label: "Мебели и интериор" },
  { id: "finishing", label: "Хамалски, довършителни или ремонтни услуги" },
  { id: "investor", label: "Инвеститор или строител" },
  { id: "other", label: "Друго" },
] as const;

export const LEAD_INTERESTS = [
  { id: "coverage", label: "Цяла София или неограничен брой райони" },
  { id: "filters", label: "Филтри: жилищни сгради, размер, само разрешения за строеж" },
  { id: "weekly", label: "Седмичен списък с възложителите от публичния регистър" },
  { id: "export", label: "Експорт в Excel/CSV" },
] as const;

export const PRICE_RANGES = [
  { id: "none", label: "Не бих платил" },
  { id: "lt10", label: "До 10 € на месец" },
  { id: "10-25", label: "10–25 € на месец" },
  { id: "25-50", label: "25–50 € на месец" },
  { id: "50-100", label: "50–100 € на месец" },
  { id: "gt100", label: "Над 100 € на месец" },
  { id: "unsure", label: "Не мога да преценя" },
] as const;

/** Rows are deleted this long after the last submission (privacy page). */
export const LEAD_RETENTION_DAYS = 365;
/** Hidden field that people never see; anything in it marks an automated submission. */
export const HONEYPOT_FIELD = "website";
export const LEAD_PAGE = "/business/";
const MAX_BODY_LENGTH = 16 * 1024;

export const LEAD_MESSAGES = {
  ok: "Благодарим! Записахме интереса ви. Ще ви пишем на посочения имейл, когато има новини за бизнес плана.",
  invalid: "Проверете полетата: нужни са валиден имейл, вид дейност, отговор за цената и съгласие.",
  limit: "Твърде много изпращания от този адрес. Опитайте отново след час.",
  error: `Формата временно не работи. Опитайте по-късно или ни пишете на ${CONTACT_EMAIL}.`,
} as const;

export type LeadResult = keyof typeof LEAD_MESSAGES;

export interface Lead {
  email: string;
  company: string | null;
  businessType: string;
  interests: string[];
  districts: string | null;
  priceRange: string;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const labelOf = (list: ReadonlyArray<{ id: string; label: string }>, id: string) => list.find((o) => o.id === id)?.label ?? id;

function optionalText(value: unknown, max: number, message: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InputError(message);
  // Free text may arrive with line breaks (textarea): keep it on one line.
  const s = value.replace(/\s+/g, " ").trim();
  if (s.length > max || CONTROL_CHARS.test(s)) throw new InputError(message);
  return s || null;
}

function choice(value: unknown, list: ReadonlyArray<{ id: string }>, message: string): string {
  if (typeof value !== "string" || !list.some((o) => o.id === value)) throw new InputError(message);
  return value;
}

/** Normalises a submission (form fields or JSON) or throws InputError with a message for the visitor. */
export function parseLead(input: { [key: string]: unknown }): Lead {
  const email = parseEmail(input.email);
  const company = optionalText(input.company, 120, "Името на фирмата може да е до 120 знака.");
  const businessType = choice(input.business_type, BUSINESS_TYPES, "Изберете вида на дейността си.");
  const priceRange = choice(input.price_range, PRICE_RANGES, "Изберете колко бихте платили на месец.");
  const districts = optionalText(input.districts, 300, "Полето за райони може да е до 300 знака.");
  const raw = Array.isArray(input.interests) ? input.interests : input.interests === undefined || input.interests === null || input.interests === "" ? [] : [input.interests];
  if (raw.length > 20 || raw.some((v) => typeof v !== "string" || !LEAD_INTERESTS.some((o) => o.id === v))) {
    throw new InputError("Невалиден избор на функции.");
  }
  const interests = LEAD_INTERESTS.map((o) => o.id as string).filter((id) => raw.includes(id));
  if (![true, "on", "1", "true", "yes"].includes(input.consent as string)) {
    throw new InputError("Отбележете съгласието, за да изпратим формата.");
  }
  return { email, company, businessType, interests, districts, priceRange };
}

/** Stores the lead; a repeat submission with the same email replaces the earlier answers. */
export async function saveLead(db: D1Database, lead: Lead, now = nowIso()): Promise<{ created: boolean }> {
  const row = await db
    .prepare(
      "INSERT INTO business_leads (email, company, business_type, interests, districts, price_range, consent_at, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7) " +
        "ON CONFLICT (email) DO UPDATE SET company = excluded.company, business_type = excluded.business_type, interests = excluded.interests, " +
        "districts = excluded.districts, price_range = excluded.price_range, consent_at = excluded.consent_at, updated_at = excluded.updated_at " +
        "RETURNING created_at, updated_at",
    )
    .bind(lead.email, lead.company, lead.businessType, lead.interests.join(","), lead.districts, lead.priceRange, now)
    .first<{ created_at: string; updated_at: string }>();
  return { created: !!row && row.created_at === row.updated_at };
}

/** Retention: removes leads whose last submission is older than 12 months. Returns the number deleted. */
export async function purgeOldLeads(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - LEAD_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { meta } = await db.prepare("DELETE FROM business_leads WHERE updated_at < ?").bind(cutoff).run();
  return meta.changes ?? 0;
}

/** Short note to the site's contact address about a new lead. */
export function leadNotification(lead: Lead): Mail {
  const rows: Array<[string, string]> = [
    ["Имейл", lead.email],
    ["Фирма", lead.company ?? "—"],
    ["Дейност", labelOf(BUSINESS_TYPES, lead.businessType)],
    ["Интерес", lead.interests.map((id) => labelOf(LEAD_INTERESTS, id)).join("; ") || "—"],
    ["Райони", lead.districts ?? "—"],
    ["Цена", labelOf(PRICE_RANGES, lead.priceRange)],
  ];
  return {
    to: CONTACT_EMAIL,
    replyTo: lead.email,
    subject: `Нов интерес към бизнес плана: ${labelOf(BUSINESS_TYPES, lead.businessType)}`.slice(0, 140),
    html: layout({
      preheader: "Нова заявка от формата „За бизнеса“.",
      heading: "Нов интерес към бизнес плана",
      body: `<table role="presentation" cellpadding="0" cellspacing="0" style="font:400 15px/1.5 Arial,Helvetica,sans-serif">${rows
        .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#5b636f;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`)
        .join("")}</table><p style="margin:16px 0 12px;color:#5b636f;font-size:13px">Изпратено от формата на akt16.org/business/. Записът се пази в таблица business_leads до 12 месеца.</p>`,
    }),
    text: `Нов интерес към бизнес плана (akt16.org/business/)\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}`,
  };
}

export interface LeadDeps {
  db: D1Database | undefined;
  /** Rate-limit bucket of the client (clientIpKey). */
  ip: string;
  /** Email binding for the owner notification; without it no notification is sent. */
  mail?: MailEnv;
  /** Runs slow work (sending the notification) after the response. */
  background?: (task: Promise<unknown>) => void;
}

/**
 * POST /api/business-lead/. A JSON body (the page's script) gets a JSON answer in the API's usual shape;
 * a plain form post (no JavaScript) is redirected back to the page, where `#lead-<result>` shows the message.
 * Order: same-origin check, honeypot, validation, rate limit, upsert, owner notification.
 */
export async function handleLeadPost(request: Request, deps: LeadDeps): Promise<Response> {
  const wantsJson = request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;
  const respond = (result: LeadResult, status: number, message: string = LEAD_MESSAGES[result]): Response => {
    if (!wantsJson) return new Response(null, { status: 303, headers: { location: `${LEAD_PAGE}#lead-${result}`, "cache-control": "no-store" } });
    if (result === "ok") return json({ ok: true, message });
    return fail(status, result === "invalid" ? "invalid_input" : result === "limit" ? "rate_limited" : "server_error", message, result === "limit" ? { "retry-after": "3600" } : undefined);
  };

  const denied = checkOrigin(request);
  if (denied) return denied;
  if (!deps.db) return respond("error", 503);

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_LENGTH) return respond("invalid", 413);
    let input: { [key: string]: unknown };
    if (wantsJson) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // reported below
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond("invalid", 400);
      input = parsed as { [key: string]: unknown };
    } else {
      const form = new URLSearchParams(raw);
      input = Object.fromEntries(form);
      input.interests = form.getAll("interests");
    }

    // Bots fill every field. Answer as if it worked and store nothing.
    if (typeof input[HONEYPOT_FIELD] === "string" && input[HONEYPOT_FIELD] !== "") return respond("ok", 200);

    let lead: Lead;
    try {
      lead = parseLead(input);
    } catch (err) {
      if (err instanceof InputError) return respond("invalid", 400, err.message);
      throw err;
    }

    const limited = await checkRateLimit(deps.db, "lead", deps.ip);
    if (limited) return respond("limit", 429);
    await recordAttempt(deps.db, "lead", deps.ip, null);

    const { created } = await saveLead(deps.db, lead);
    await purgeOldLeads(deps.db).catch(() => 0);

    if (created && deps.mail?.EMAIL) {
      // Failing to notify must never fail the submission.
      const task = sendMail(deps.mail, leadNotification(lead)).catch(() => undefined);
      if (deps.background) deps.background(task);
      else void task;
    }
    return respond("ok", 200);
  } catch (err) {
    // Typically the migration has not been applied yet (missing table or rate-limit kind).
    console.error("[leads]", err);
    return respond("error", 500);
  }
}
