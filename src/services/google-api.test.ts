/**
 * @vitest-environment jsdom
 *
 * fetchWithRetry used to read OAuth tokens out of localStorage and send
 * them on every request in an `x-google-tokens` header - a workaround for
 * running inside AI Studio's iframe, where the session cookie was blocked
 * as third-party. The app is now always a top-level page and the
 * orns_session cookie is the only credential, so these tests guard that
 * no token header is ever sent and that the caller's options pass through
 * untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "./google-api";

describe("fetchWithRetry - sends the caller's request as-is", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, clone: () => ({ text: async () => "" }) }));
    // A stale token copy left behind by the old iframe login must not be picked up.
    localStorage.setItem("google_tokens", "stale-token-string");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("never adds an x-google-tokens header, even with a stale token in localStorage", async () => {
    const options = { method: "POST", headers: { "Content-Type": "application/json" } };

    await fetchWithRetry("/api/whatever", options);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("passes the caller's options object through unmodified", async () => {
    const options: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" };

    await fetchWithRetry("/api/whatever", options);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1]).toBe(options);
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
  });
});
