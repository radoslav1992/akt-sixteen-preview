// Accounts, sessions and watchlist helpers for the on-demand /api/auth and
// /api/watchlist routes. WebCrypto only, so it runs unchanged in Workers and Node.
import type { APIContext } from "astro";

export const SESSION_COOKIE = "akt16_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // seconds
// Workers reject PBKDF2 above 100000 iterations, so this is also the ceiling for stored hashes.
export const PBKDF2_ITERATIONS = 100000;
const MAX_PBKDF2_ITERATIONS = 100000;
// Same format as a real hash; verified against for unknown emails so both paths cost the same.
export const DUMMY_PASSWORD_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${"A".repeat(22)}==$${"A".repeat(43)}=`;

export const WATCH_KINDS = ["record", "parcel", "company", "region", "neighborhood", "search"] as const;
export const WATCHLIST_LIMIT = 500;
export const MERGE_LIMIT = 200;
const MAX_BODY_LENGTH = 256 * 1024;

const RATE_LIMITS = {
  login: { max: 10, seconds: 15 * 60 }, // failed logins per IP (or per email)
  register: { max: 5, seconds: 60 * 60 }, // registration attempts per IP
};

export type WatchKind = (typeof WATCH_KINDS)[number];
export type AttemptKind = keyof typeof RATE_LIMITS;

export interface WatchItem {
  kind: WatchKind;
  key: string;
  label: string;
  url: string;
}

export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
  email_alerts: boolean;
}

const MESSAGES = {
  invalid_input: "Невалидни данни.",
  unauthorized: "Моля, влезте в профила си.",
  forbidden: "Заявката беше отхвърлена.",
  email_taken: "Вече има профил с този имейл адрес.",
  invalid_credentials: "Грешен имейл или парола.",
  rate_limited: "Твърде много опити. Опитайте отново по-късно.",
  limit_reached: `Списъкът за следене може да съдържа най-много ${WATCHLIST_LIMIT} записа.`,
  unsupported_media_type: "Заявката трябва да е във формат JSON.",
  payload_too_large: "Заявката е твърде голяма.",
  accounts_unavailable: "Профилите временно не са достъпни.",
  server_error: "Възникна грешка. Опитайте отново.",
};

export type ErrorCode = keyof typeof MESSAGES;

/* Responses */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function fail(status: number, error: ErrorCode, message = MESSAGES[error], headers?: Record<string, string>) {
  return json({ error, message }, status, headers);
}

/* Encoding */

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function nowIso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

/* Passwords and tokens */

async function pbkdf2(password: string, salt: BufferSource, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, rounds, salt, hash] = stored.split("$");
  const iterations = Number(rounds);
  if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) {
    return false;
  }
  try {
    const expected = fromBase64(hash);
    if (expected.length !== 32) return false;
    return timingSafeEqual(await pbkdf2(password, fromBase64(salt), iterations), expected);
  } catch {
    return false;
  }
}

export function newSessionToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Cookies */

const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/";

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null);
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value
    }
    cookies[name] = value;
  }
  return cookies;
}

/* Validation: parsers return the normalized value or throw InputError (→ 400 invalid_input). */

export class InputError extends Error {}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
const PATH_PATTERN = /^\/(?![/\\])[^\s\\]*$/;

function text(value: unknown, max: number, message: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || s.length > max || CONTROL_CHARS.test(s)) throw new InputError(message);
  return s;
}

export function parseEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email) || CONTROL_CHARS.test(email)) {
    throw new InputError("Въведете валиден имейл адрес.");
  }
  return email;
}

export function parsePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw new InputError("Паролата трябва да е между 8 и 200 знака.");
  }
  return value;
}

export function parseName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const name = typeof value === "string" ? value.trim() : null;
  if (name === null || name.length > 80 || CONTROL_CHARS.test(name)) {
    throw new InputError("Името може да е до 80 знака.");
  }
  return name || null;
}

export function parseWatchKey(value: unknown): Pick<WatchItem, "kind" | "key"> {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (!WATCH_KINDS.includes(v.kind as WatchKind)) throw new InputError("Невалиден тип на записа.");
  return { kind: v.kind as WatchKind, key: text(v.key, 200, "Невалиден идентификатор на записа.") };
}

export function parseWatchItem(value: unknown): WatchItem {
  const { kind, key } = parseWatchKey(value);
  const v = value as Record<string, unknown>;
  const label = text(v.label, 200, "Невалидно заглавие на записа.");
  const url = typeof v.url === "string" ? v.url.trim() : "";
  if (url.length > 300 || !PATH_PATTERN.test(url) || CONTROL_CHARS.test(url)) {
    throw new InputError("Невалиден адрес на записа.");
  }
  return { kind, key, label, url };
}

/* Request checks */

// Cross-site request forgery guard for state-changing methods.
export function checkOrigin(request: Request): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host === new URL(request.url).host) return null;
    } catch {
      // "null" or malformed origin
    }
  } else if (request.headers.get("sec-fetch-site") === "same-origin") {
    return null;
  }
  return fail(403, "forbidden");
}

// Rate-limit bucket: the address itself for IPv4, the /64 network for IPv6.
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/* Sessions */

export const USER_COLUMNS = "id, email, name, email_alerts";

export function toUser(row: Record<string, unknown>): SessionUser {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: (row.name as string | null) ?? null,
    email_alerts: Boolean(row.email_alerts),
  };
}

export async function getSession(db: D1Database, request: Request) {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  const id = await hashToken(token);
  const row = await db
    .prepare(
      "SELECT s.expires_at, u.id, u.email, u.name, u.email_alerts " +
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const expiresAt = String(row.expires_at);
  if (expiresAt <= nowIso()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  return { id, token, expiresAt, user: toUser(row) };
}

export async function getSessionUser(db: D1Database, request: Request): Promise<SessionUser | null> {
  return (await getSession(db, request))?.user ?? null;
}

// Stores a new session for the user and returns the Set-Cookie header value.
export async function createSession(db: D1Database, userId: number, request: Request): Promise<string> {
  const token = newSessionToken();
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)")
      .bind(await hashToken(token), userId, now, nowIso(SESSION_MAX_AGE), request.headers.get("user-agent")?.slice(0, 200) ?? null),
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, userId),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
  return sessionCookie(token);
}

/* Rate limiting */

export async function checkRateLimit(db: D1Database, kind: AttemptKind, ip: string, email: string | null = null) {
  const { max, seconds } = RATE_LIMITS[kind];
  const row = await db
    .prepare(
      "SELECT SUM(ip = ?1) AS by_ip, SUM(email = ?2) AS by_email FROM auth_attempts " +
        "WHERE kind = ?3 AND created_at > ?4 AND (ip = ?1 OR email = ?2)",
    )
    .bind(ip, email, kind, nowIso(-seconds))
    .first<{ by_ip: number | null; by_email: number | null }>();
  if (Math.max(row?.by_ip ?? 0, row?.by_email ?? 0) < max) return null;
  return fail(429, "rate_limited", undefined, { "retry-after": String(seconds) });
}

export async function recordAttempt(db: D1Database, kind: AttemptKind, ip: string, email: string | null) {
  await db.batch([
    db.prepare("INSERT INTO auth_attempts (kind, ip, email, created_at) VALUES (?, ?, ?, ?)").bind(kind, ip, email, nowIso()),
    db.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(nowIso(-24 * 60 * 60)),
  ]);
}

/* Watchlist */

export const WATCH_COLUMNS = "kind, key, label, url, created_at, last_seen_at";

export async function listWatchlist(db: D1Database, userId: number) {
  const { results } = await db
    .prepare(`SELECT ${WATCH_COLUMNS} FROM watchlist WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .bind(userId)
    .all();
  return results;
}

/* Route wrapper */

export interface HandlerContext {
  db: D1Database;
  request: Request;
  body: Record<string, unknown>;
  /** Signed-in user; only set when the route was registered with `auth: true`. */
  user: SessionUser;
  ip: string;
}

export async function handle(
  db: D1Database | undefined,
  ctx: APIContext,
  options: { auth?: boolean; body?: boolean },
  handler: (c: HandlerContext) => Promise<Response>,
): Promise<Response> {
  if (!db) return fail(503, "accounts_unavailable");
  const { request } = ctx;
  const denied = checkOrigin(request);
  if (denied) return denied;
  if (options.body && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return fail(415, "unsupported_media_type");
  }
  try {
    const user = options.auth ? await getSessionUser(db, request) : null;
    if (options.auth && !user) return fail(401, "unauthorized");
    let body: Record<string, unknown> = {};
    if (options.body) {
      const raw = await request.text();
      if (raw.length > MAX_BODY_LENGTH) return fail(413, "payload_too_large");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // reported below
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InputError(MESSAGES.invalid_input);
      body = parsed as Record<string, unknown>;
    }
    let ip = "unknown";
    try {
      ip = ctx.clientAddress || ip;
    } catch {
      // no cf-connecting-ip (e.g. some local setups)
    }
    return await handler({ db, request, body, user: user as SessionUser, ip: ipKey(ip) });
  } catch (err) {
    if (err instanceof InputError) return fail(400, "invalid_input", err.message);
    console.error("[auth]", err);
    return fail(500, "server_error");
  }
}
