/**
 * @vitest-environment jsdom
 *
 * google-api.ts had zero direct test coverage before this. Scoped to the
 * one real, verified bug flagged in refactor-opportunities.md -
 * fetchWithRetry mutating the caller's options object (and its headers)
 * in place when injecting the x-google-tokens auth header - rather than
 * full coverage of every exported function, which is a separate, larger
 * gap. No current call site in this codebase reuses an options object
 * across multiple fetchWithRetry calls (every call site passes a fresh
 * literal), so this wasn't yet an observed symptom anywhere - but it's a
 * directly provable, currently-reachable contract violation of the
 * function itself: pass in a shared options object and it comes back
 * mutated, regardless of what any particular caller does with it today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "./google-api";

describe("fetchWithRetry - does not mutate the caller's options object", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, clone: () => ({ text: async () => "" }) }));
    Object.defineProperty(window, "localStorage", {
      value: { getItem: vi.fn(() => "fake-token-string"), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a plain-object headers literal untouched on the caller's side", async () => {
    const options = { method: "POST", headers: { "Content-Type": "application/json" } };

    await fetchWithRetry("/api/whatever", options);

    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect("x-google-tokens" in options.headers).toBe(false);
  });

  it("does not leak one call's injected token header into a second call sharing the same options object", async () => {
    const sharedOptions: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" } };

    await fetchWithRetry("/api/first", sharedOptions);
    await fetchWithRetry("/api/second", sharedOptions);

    // Both real fetch calls must have received the injected header...
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1].headers["x-google-tokens"]).toBe("fake-token-string");
    expect(fetchMock.mock.calls[1][1].headers["x-google-tokens"]).toBe("fake-token-string");
    // ...but the caller's own shared object must never have been touched.
    expect(sharedOptions.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("leaves a caller's Headers instance untouched", async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    const options = { method: "POST", headers };

    await fetchWithRetry("/api/whatever", options);

    expect(headers.has("x-google-tokens")).toBe(false);
  });

  it("leaves a caller's array-form headers untouched", async () => {
    const headersArray: [string, string][] = [["Content-Type", "application/json"]];
    const options = { method: "POST", headers: headersArray };

    await fetchWithRetry("/api/whatever", options);

    expect(headersArray).toEqual([["Content-Type", "application/json"]]);
  });
});
