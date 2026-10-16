import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  InputError,
  SESSION_COOKIE,
  checkOrigin,
  clearSessionCookie,
  hashPassword,
  hashToken,
  ipKey,
  newSessionToken,
  parseCookies,
  parseEmail,
  parseName,
  parsePassword,
  parseWatchItem,
  parseWatchKey,
  sessionCookie,
  timingSafeEqual,
  verifyPassword,
} from "../src/lib/auth";

describe("passwords", () => {
  it("hashes with salted PBKDF2 and verifies the same password only", async () => {
    const stored = await hashPassword("тайна парола 123");
    expect(stored).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(await verifyPassword("тайна парола 123", stored)).toBe(true);
    expect(await verifyPassword("тайна парола 124", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
    expect(await hashPassword("тайна парола 123")).not.toBe(stored);
  });

  it("rejects malformed, foreign and over-limit hashes without throwing", async () => {
    const stored = await hashPassword("password1");
    const [, , salt, hash] = stored.split("$");
    expect(await verifyPassword("password1", "")).toBe(false);
    expect(await verifyPassword("password1", "bcrypt$10$abc$def")).toBe(false);
    expect(await verifyPassword("password1", `pbkdf2$100001$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("password1", `pbkdf2$abc$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("password1", `pbkdf2$100000$${salt}$!!`)).toBe(false);
    expect(await verifyPassword("password1", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("compares bytes in constant time", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("session tokens", () => {
  it("creates unique 32-byte base64url tokens", () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
  });

  it("stores only the sha-256 hex of a token", async () => {
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashToken(newSessionToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cookies", () => {
  it("serializes a hardened 30-day session cookie and its removal", () => {
    expect(sessionCookie("tok")).toBe(
      `${SESSION_COOKIE}=tok; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
    );
    expect(clearSessionCookie()).toBe(`${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  });

  it("parses cookie headers", () => {
    expect(parseCookies("a=1; akt16_session=x-Y_z; b=%D0%B0")).toEqual({ a: "1", akt16_session: "x-Y_z", b: "а" });
    expect(parseCookies('a="quoted"; a=second; broken; =x; c=%E0')).toEqual({ a: "quoted", c: "%E0" });
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("constructor=1").constructor).toBe("1");
  });
});

describe("validation", () => {
  it("normalizes and validates emails", () => {
    expect(parseEmail("  Ivan.Petrov@Example.BG ")).toBe("ivan.petrov@example.bg");
    for (const bad of ["", "ivan", "ivan@", "@example.bg", "ivan@example", "ivan@@example.bg", "iv an@example.bg",
      "ivan@example..bg", "ivan@.example.bg", "ivan\u0000@example.bg", `${"a".repeat(65)}@example.bg`,
      `a@${"b".repeat(250)}.bg`, 42, null]) {
      expect(() => parseEmail(bad), String(bad)).toThrow(InputError);
    }
  });

  it("requires 8 to 200 character passwords without trimming them", () => {
    expect(parsePassword("  8chars ")).toBe("  8chars ");
    expect(parsePassword("x".repeat(200))).toHaveLength(200);
    expect(() => parsePassword("1234567")).toThrow(InputError);
    expect(() => parsePassword("x".repeat(201))).toThrow(InputError);
    expect(() => parsePassword(12345678)).toThrow(InputError);
  });

  it("accepts an optional, trimmed name of up to 80 characters", () => {
    expect(parseName(undefined)).toBeNull();
    expect(parseName(null)).toBeNull();
    expect(parseName("   ")).toBeNull();
    expect(parseName("  Мария  ")).toBe("Мария");
    expect(parseName("я".repeat(80))).toHaveLength(80);
    expect(() => parseName("я".repeat(81))).toThrow(InputError);
    expect(() => parseName({})).toThrow(InputError);
    expect(() => parseName("a\nb")).toThrow(InputError);
  });

  it("validates watchlist items", () => {
    const item = { kind: "record", key: "1014-14092026", label: " Акт 16 № 1014 ", url: "/register/act16/1014-14092026/" };
    expect(parseWatchItem(item)).toEqual({ ...item, label: "Акт 16 № 1014" });
    expect(parseWatchItem({ ...item, kind: "search", url: "/register/act16/?q=Младост&region=x" }).kind).toBe("search");
    expect(parseWatchKey({ kind: "region", key: "mladost", extra: 1 })).toEqual({ kind: "region", key: "mladost" });

    const bad = [
      { kind: "user" },
      { kind: "__proto__" },
      { key: "" },
      { key: "k".repeat(201) },
      { label: "" },
      { label: "l".repeat(201) },
      { url: "https://evil.example/" },
      { url: "//evil.example/" },
      { url: "/\\evil.example/" },
      { url: "javascript:alert(1)" },
      { url: "register/act16/" },
      { url: "/a b" },
      { url: `/${"u".repeat(300)}` },
      { url: undefined },
    ];
    for (const patch of bad) {
      expect(() => parseWatchItem({ ...item, ...patch }), JSON.stringify(patch)).toThrow(InputError);
    }
    expect(() => parseWatchItem(null)).toThrow(InputError);
    expect(() => parseWatchItem("record")).toThrow(InputError);
  });
});

describe("checkOrigin", () => {
  const request = (method: string, headers: Record<string, string>) =>
    new Request("https://akt16.org/api/watchlist/", { method, headers });

  it("lets safe methods through", () => {
    expect(checkOrigin(request("GET", { origin: "https://evil.example" }))).toBeNull();
  });

  it("allows same-host origins and same-origin fetch metadata", () => {
    expect(checkOrigin(request("POST", { origin: "https://akt16.org" }))).toBeNull();
    expect(checkOrigin(request("DELETE", { origin: "https://akt16.org" }))).toBeNull();
    expect(checkOrigin(request("POST", { "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("rejects cross-site, opaque and missing origins with 403", async () => {
    const cases: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "https://akt16.org.evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
      {},
    ];
    for (const headers of cases) {
      const res = checkOrigin(request("POST", headers));
      expect(res?.status, JSON.stringify(headers)).toBe(403);
      expect(res?.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res?.headers.get("cache-control")).toBe("no-store");
      expect(await res?.json()).toMatchObject({ error: "forbidden" });
    }
  });
});

describe("rate-limit buckets", () => {
  it("groups IPv6 clients by /64 and keeps IPv4 addresses", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8:1:2::1")).toBe(ipKey("2001:db8:1:2:ffff::9"));
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("unknown")).toBe("unknown");
  });
});
