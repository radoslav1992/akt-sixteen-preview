// Client-side wording and state of the „Извести ме по имейл“ buttons (src/scripts/follow.ts).
import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { followState, followedHint, REGISTER_URL } = await import("../src/scripts/follow");
const { clearFollowIntent, getFollowIntent, setCachedUser, setFollowIntent } = await import("../src/scripts/watchlist");

const item = { kind: "region" as const, key: "lozenets", label: "Район Лозенец", url: "/region/lozenets/" };
beforeEach(() => store.clear());

describe("what a followed item says under the button", () => {
  it("tells a guest that nothing is emailed without an account and links to registration", () => {
    expect(followState()).toBe("guest");
    expect(followedHint(true)).toContain("само на това устройство");
    expect(followedHint(true)).toContain(`href="${REGISTER_URL}"`);
    expect(REGISTER_URL).toBe("/account/?mode=register");
  });

  it("follows the account: unverified, alerts off, all set", () => {
    setCachedUser({ id: 1, email: "a@b.bg", name: null, email_alerts: true, email_verified: false });
    expect(followState()).toBe("unverified");
    expect(followedHint(true)).toContain("потвърдите имейла");
    setCachedUser({ id: 1, email: "a@b.bg", name: null, email_alerts: false, email_verified: true });
    expect(followState()).toBe("muted");
    expect(followedHint(true)).toContain("изключени");
    setCachedUser({ id: 1, email: "a@b.bg", name: null, email_alerts: true, email_verified: true });
    expect(followState()).toBe("on");
    expect(followedHint(true)).toContain("най-много едно писмо на ден");
  });

  it("never promises email for items the digest cannot match", () => {
    for (const state of ["guest", "muted", "unverified", "on"] as const) {
      expect(followedHint(false, state)).not.toMatch(/имейл|писм/);
      expect(followedHint(false, state)).toContain("Следени");
    }
  });
});

describe("the item a guest asked to be alerted about", () => {
  it("is remembered for the account page and cleared afterwards", () => {
    expect(getFollowIntent()).toBeNull();
    setFollowIntent(item);
    expect(getFollowIntent()).toEqual(item);
    clearFollowIntent();
    expect(getFollowIntent()).toBeNull();
  });

  it("expires after a week and ignores tampered values", () => {
    store.set("akt16:follow-intent", JSON.stringify({ ...item, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(getFollowIntent()).toBeNull();
    store.set("akt16:follow-intent", JSON.stringify({ ...item, url: "//evil.example/", at: Date.now() }));
    expect(getFollowIntent()).toBeNull();
    store.set("akt16:follow-intent", "{not json");
    expect(getFollowIntent()).toBeNull();
  });
});
