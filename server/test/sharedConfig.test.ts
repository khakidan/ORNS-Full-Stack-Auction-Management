import { describe, it, expect, vi, beforeEach } from "vitest";

let configDoc: any = {};
let failRead = false;
const get = vi.fn(async () => {
  if (failRead) throw new Error("invalid_grant");
  return { data: () => configDoc };
});
vi.mock("../services/firebaseAdmin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ get }) }) }),
}));

// setup.ts mocks this module for every other test; this file tests the real one.
const { getPaypalIsSandbox, _resetSharedConfigForTesting } = await vi.importActual<typeof import("../services/sharedConfig")>("../services/sharedConfig");

describe("getPaypalIsSandbox", () => {
  beforeEach(() => {
    _resetSharedConfigForTesting();
    configDoc = {};
    failRead = false;
    get.mockClear();
  });

  it("is live only when settings/global says paypalIsSandbox: false", async () => {
    configDoc = { paypalIsSandbox: false };
    expect(await getPaypalIsSandbox(1000)).toBe(false);
  });

  it("is sandbox when the field is true or missing - a missing value never means live", async () => {
    expect(await getPaypalIsSandbox(1000)).toBe(true);
    _resetSharedConfigForTesting();
    configDoc = { paypalIsSandbox: true };
    expect(await getPaypalIsSandbox(1000)).toBe(true);
  });

  it("caches the value for 30 seconds, then re-reads", async () => {
    configDoc = { paypalIsSandbox: false };
    await getPaypalIsSandbox(0);
    configDoc = { paypalIsSandbox: true };
    expect(await getPaypalIsSandbox(29_000)).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await getPaypalIsSandbox(31_000)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps the last value read when a refresh fails", async () => {
    configDoc = { paypalIsSandbox: false };
    await getPaypalIsSandbox(0);
    failRead = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getPaypalIsSandbox(60_000)).toBe(false);
    warn.mockRestore();
  });

  it("throws rather than guessing when Firestore has never been readable", async () => {
    failRead = true;
    await expect(getPaypalIsSandbox(0)).rejects.toThrow(/Couldn't read the PayPal sandbox\/live setting/);
  });
});
