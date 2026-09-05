/**
 * Tests server/services/receiptService.ts's processAllEmails - previously
 * had zero test coverage of any kind. Written alongside financeUtils.ts's
 * new negative-bid-amount guard (calculatePayPalSurcharge now throws
 * instead of silently returning a nonsensical negative invoice total):
 * before that guard existed, ANY thrown error from processEmail (a Sheets
 * API error, a malformed row, etc.) would already abort this whole batch
 * loop uncaught, silently skipping every remaining bidder's receipt email -
 * making the new guard's throw easier to hit in practice. Fixed by wrapping
 * the per-bidder call in its own try/catch. These tests pin that resilience
 * directly, with processEmail itself mocked away (its own Sheets/Gmail/OAuth
 * logic is a separate, larger concern - out of scope here).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState } from "./handlers";

vi.mock("../services/emailService", () => ({
  processEmail: vi.fn(),
}));

import { processAllEmails } from "../services/receiptService";
import { processEmail } from "../services/emailService";
import { getAuthenticatedClient } from "../services/oauth";

const mockedProcessEmail = vi.mocked(processEmail);

const BIDDER_NUMBERS_ROWS = [
  ["ID", "First Name", "Last Name", "Email"],
  ["101", "Alice", "One", "alice@example.com"],
  ["102", "Bob", "Two", "bob@example.com"],
  ["103", "Carol", "Three", "carol@example.com"],
];

function mockBidderNumbers(rows: string[][] = BIDDER_NUMBERS_ROWS) {
  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      const range = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (range.includes("Bidder-Numbers")) {
        return HttpResponse.json({ values: rows });
      }
      return HttpResponse.json({ values: [] });
    })
  );
}

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const fakeClient = getAuthenticatedClient(mockTokens);

describe("processAllEmails - per-bidder resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHandlersState();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it("emails every bidder and counts each success", async () => {
    mockBidderNumbers();
    mockedProcessEmail.mockResolvedValue({ success: true });

    const sentCount = await processAllEmails(fakeClient, "ss-id", "items-ss-id");

    expect(sentCount).toBe(3);
    expect(processEmail).toHaveBeenCalledTimes(3);
  });

  it("does not abort the batch when one bidder's processEmail throws - the rest still get emailed", async () => {
    mockBidderNumbers();
    mockedProcessEmail.mockImplementation(async (_client, _spreadsheetId, id) => {
      if (id === "102") {
        // Simulates calculatePayPalSurcharge throwing for a corrupted
        // negative price on this one bidder's won items.
        throw new Error("calculatePayPalSurcharge: bidAmount must not be negative (got -5).");
      }
      return { success: true };
    });

    const sentCount = await processAllEmails(fakeClient, "ss-id", "items-ss-id");
    expect(sentCount).toBe(2);

    // Every bidder was still attempted, not just the ones before the failure.
    expect(processEmail).toHaveBeenCalledTimes(3);
    expect(processEmail).toHaveBeenCalledWith(fakeClient, "ss-id", "103", "items-ss-id");
  });

  it("does not count a bidder whose processEmail call returns success: false", async () => {
    mockBidderNumbers();
    mockedProcessEmail.mockImplementation(async (_client, _spreadsheetId, id) => {
      if (id === "102") return { success: false, error: "No items won for this bidder." };
      return { success: true };
    });

    const sentCount = await processAllEmails(fakeClient, "ss-id", "items-ss-id");

    expect(sentCount).toBe(2);
  });

  it("skips rows with no bidder id or no email without calling processEmail", async () => {
    mockBidderNumbers([
      ["ID", "First Name", "Last Name", "Email"],
      ["101", "Alice", "One", "alice@example.com"],
      ["", "No", "Id", "noid@example.com"],
      ["104", "No", "Email", ""],
    ]);
    mockedProcessEmail.mockResolvedValue({ success: true });

    const sentCount = await processAllEmails(fakeClient, "ss-id", "items-ss-id");

    expect(sentCount).toBe(1);
    expect(processEmail).toHaveBeenCalledTimes(1);
    expect(processEmail).toHaveBeenCalledWith(fakeClient, "ss-id", "101", "items-ss-id");
  });
});
