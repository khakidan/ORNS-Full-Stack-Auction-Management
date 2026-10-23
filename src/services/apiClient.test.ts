import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => ""),
}));

import { fetchWithRetry } from "@/services/google-api";
import { postJson, HttpError } from "./apiClient";
import { isConfiguredId } from "@/lib/configuredId";

const mockedFetch = vi.mocked(fetchWithRetry);
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("postJson", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs the body as JSON and returns the parsed reply", async () => {
    mockedFetch.mockResolvedValue(reply(200, { success: true, id: 7 }));

    await expect(postJson("/api/thing", { a: 1 }, "Failed")).resolves.toEqual({ success: true, id: 7 });
    expect(mockedFetch).toHaveBeenCalledWith("/api/thing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
      credentials: "include",
    });
  });

  it("throws the route's own `error` with the status", async () => {
    mockedFetch.mockResolvedValue(reply(409, { error: "Item changed" }));

    const error = await postJson("/api/thing", {}, "Failed").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).toBe("Item changed");
    expect(error.status).toBe(409);
  });

  it("prefers the error handler's `message` (the real reason) over its generic `error`", async () => {
    mockedFetch.mockResolvedValue(reply(500, { error: "Internal Server Error", message: "Sheet not found" }));
    await expect(postJson("/api/thing", {}, "Failed")).rejects.toThrow("Sheet not found");
  });

  it("falls back to the given text plus the status when the reply has no reason", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("not JSON"); } } as unknown as Response);
    await expect(postJson("/api/thing", {}, "Failed to save")).rejects.toThrow("Failed to save (status 502)");
  });

  it("treats a 200 reply carrying `error` as a failure", async () => {
    mockedFetch.mockResolvedValue(reply(200, { error: "No items won." }));
    await expect(postJson("/api/thing", {}, "Failed")).rejects.toThrow("No items won.");
  });

  it("lets a no-answer error from fetchWithRetry through unchanged", async () => {
    const unreachable = new Error("offline");
    mockedFetch.mockRejectedValue(unreachable);
    await expect(postJson("/api/thing", {}, "Failed")).rejects.toBe(unreachable);
  });
});

describe("isConfiguredId", () => {
  it.each([undefined, null, "", "undefined", "null", "PASTE_SPREADSHEET_ID_HERE"])("is false for %j", (id) => {
    expect(isConfiguredId(id as any)).toBe(false);
  });

  it("is true for a real ID", () => {
    expect(isConfiguredId("1AbC-dEf_123")).toBe(true);
  });
});
