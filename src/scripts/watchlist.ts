// Watchlist ("Следени"): stored locally for guests and synced to the account (D1) after sign-in.

export type WatchKind = "record" | "parcel" | "company" | "region" | "neighborhood" | "search";

export interface WatchItem {
  kind: WatchKind;
  key: string;
  label: string;
  url: string;
  created_at?: string;
  last_seen_at?: string | null;
}

export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
  email_alerts?: number | boolean;
  email_verified?: boolean;
}

const ITEMS_KEY = "akt16:watch";
const USER_KEY = "akt16:user";
const listeners = new Set<() => void>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getItems(): WatchItem[] {
  return read<WatchItem[]>(ITEMS_KEY, []);
}

function setItems(items: WatchItem[]): void {
  write(ITEMS_KEY, items);
  listeners.forEach((fn) => fn());
}

export function getCachedUser(): SessionUser | null {
  return read<SessionUser | null>(USER_KEY, null);
}

export function setCachedUser(user: SessionUser | null): void {
  write(USER_KEY, user);
  listeners.forEach((fn) => fn());
}

export function onChange(fn: () => void): void {
  listeners.add(fn);
}

export function isWatched(kind: WatchKind, key: string): boolean {
  return getItems().some((i) => i.kind === kind && i.key === key);
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) setCachedUser(null);
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { status: res.status, code: data.error });
  return data as T;
}

export async function addItem(item: WatchItem): Promise<void> {
  const now = new Date().toISOString();
  setItems([{ ...item, created_at: now, last_seen_at: now }, ...getItems().filter((i) => !(i.kind === item.kind && i.key === item.key))]);
  if (getCachedUser()) await api("POST", "/api/watchlist/", item).catch(() => {});
}

export async function removeItem(kind: WatchKind, key: string): Promise<void> {
  setItems(getItems().filter((i) => !(i.kind === kind && i.key === key)));
  if (getCachedUser()) await api("DELETE", "/api/watchlist/", { kind, key }).catch(() => {});
}

export async function markSeen(kind: WatchKind, key: string): Promise<void> {
  const now = new Date().toISOString();
  setItems(getItems().map((i) => (i.kind === kind && i.key === key ? { ...i, last_seen_at: now } : i)));
  if (getCachedUser()) await api("POST", "/api/watchlist/seen/", { kind, key }).catch(() => {});
}

/** After sign-in: push guest items to the account and adopt the merged list. */
export async function syncAfterLogin(): Promise<void> {
  const local = getItems();
  const { items } = local.length
    ? await api<{ items: WatchItem[] }>("POST", "/api/watchlist/merge/", { items: local.slice(0, 200) })
    : await api<{ items: WatchItem[] }>("GET", "/api/watchlist/");
  setItems(items);
}

export async function refreshSession(): Promise<SessionUser | null> {
  try {
    const { user } = await api<{ user: SessionUser | null }>("GET", "/api/auth/me/");
    setCachedUser(user);
    if (user) {
      const { items } = await api<{ items: WatchItem[] }>("GET", "/api/watchlist/");
      setItems(items);
    }
    return user;
  } catch {
    return getCachedUser();
  }
}

export const auth = {
  register: (email: string, password: string, name?: string, emailAlerts = true) =>
    api<{ user: SessionUser }>("POST", "/api/auth/register/", { email, password, name, email_alerts: emailAlerts }),
  login: (email: string, password: string) => api<{ user: SessionUser }>("POST", "/api/auth/login/", { email, password }),
  logout: () => api("POST", "/api/auth/logout/", {}),
  settings: (data: { name?: string; email_alerts?: boolean }) => api<{ user: SessionUser }>("POST", "/api/auth/settings/", data),
  deleteAccount: (password: string) => api("DELETE", "/api/auth/account/", { password }),
  verify: (token: string) => api<{ ok: true }>("POST", "/api/auth/verify/", { token }),
  resendVerification: () => api<{ ok: true; already?: boolean }>("POST", "/api/auth/verify-resend/", {}),
  forgot: (email: string) => api<{ ok: true; message: string }>("POST", "/api/auth/forgot/", { email }),
  reset: (token: string, password: string) => api<{ user: SessionUser }>("POST", "/api/auth/reset/", { token, password }),
  testAlert: () => api<{ ok: true; documents: number }>("POST", "/api/alerts/test/", {}),
};
