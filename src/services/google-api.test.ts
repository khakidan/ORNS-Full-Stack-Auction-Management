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
import { fetchWithRetry, ServerUnreachableError } from "./google-api";
import { getRetryStatus, _resetRetryStatusForTesting } from "@/lib/syncStatus";

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

/**
 * Milestone A: retries are reported to the sync banner, and a request that
 * never got an answer throws ServerUnreachableError - distinct from a 4xx,
 * which comes back as a Response.
 */
describe("fetchWithRetry - retry reporting", () => {
  const response = (status: number) => ({ ok: status < 400, status, clone: () => ({ text: async () => "" }) });

  beforeEach(() => {
    vi.useFakeTimers();
    _resetRetryStatusForTesting();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports the retry while it waits, then the recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200)));

    const pending = fetchWithRetry("/api/x");
    await vi.waitFor(() => expect(getRetryStatus()).toMatchObject({ retrying: 1, attempt: 2, maxAttempts: 4 }));
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: expect.any(Number) });
  });

  it("throws ServerUnreachableError after the last attempt, keeping the original message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const pending = fetchWithRetry("/api/x", {}, 2);
    const assertion = expect(pending).rejects.toSatisfy((e: any) => e instanceof ServerUnreachableError && e.message === "Failed to fetch");
    await vi.runAllTimersAsync();
    await assertion;
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: null });
  });

  it("returns a 4xx as a Response, without retrying or reporting anything", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409)));

    const res = await fetchWithRetry("/api/x");

    expect(res.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getRetryStatus().retrying).toBe(0);
  });
});
