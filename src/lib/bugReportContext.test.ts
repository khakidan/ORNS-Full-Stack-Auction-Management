/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatAppState, getCurrentRoute, formatBrowserInfo, formatConsoleActivity } from "./bugReportContext";

describe("formatAppState", () => {
  it("includes every field in a readable, greppable form", () => {
    const text = formatAppState({
      biddersCount: 42,
      itemsCount: 10,
      attendeesCount: 30,
      winnersCount: 8,
      isAuctionClosed: false,
      bidManagementSpreadsheetConfigured: true,
      auctionItemsSpreadsheetConfigured: true,
      auctionTicketsSpreadsheetConfigured: false,
    });

    expect(text).toContain("Bidders: 42");
    expect(text).toContain("Items: 10");
    expect(text).toContain("Attendees: 30");
    expect(text).toContain("Winners recorded: 8");
    expect(text).toContain("Auction closed: false");
    expect(text).toContain("Auction Tickets spreadsheet configured: false");
  });
});

describe("getCurrentRoute", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads the workflow from localStorage and the path from window.location", () => {
    localStorage.setItem("activeWorkflow", "items");
    vi.spyOn(window, "location", "get").mockReturnValue({ pathname: "/AuctionItemsWorkflow" } as Location);

    expect(getCurrentRoute()).toBe("/AuctionItemsWorkflow (workflow: items)");
  });

  it("includes the active bid sub-tab when the workflow is 'bids'", () => {
    localStorage.setItem("activeWorkflow", "bids");
    localStorage.setItem("activeBidTab", "checkout");
    vi.spyOn(window, "location", "get").mockReturnValue({ pathname: "/BidManagement" } as Location);

    expect(getCurrentRoute()).toBe("/BidManagement (workflow: bids, tab: checkout)");
  });

  it("falls back to 'unknown' when no workflow has ever been recorded", () => {
    vi.spyOn(window, "location", "get").mockReturnValue({ pathname: "/" } as Location);

    expect(getCurrentRoute()).toBe("/ (workflow: unknown)");
  });
});

describe("formatBrowserInfo", () => {
  it("includes user-agent, platform, and viewport size", () => {
    const text = formatBrowserInfo();
    expect(text).toContain("User-Agent:");
    expect(text).toContain("Platform:");
    expect(text).toMatch(/Viewport: \d+x\d+/);
  });
});

describe("formatConsoleActivity", () => {
  it("renders '(none captured)' for an empty buffer", () => {
    expect(formatConsoleActivity([])).toBe("(none captured)");
  });

  it("renders each entry with its level and timestamp", () => {
    const text = formatConsoleActivity([
      { level: "error", message: "boom", timestamp: "2026-09-03T12:00:00.000Z" },
      { level: "warn", message: "careful", timestamp: "2026-09-03T12:00:01.000Z" },
    ]);
    expect(text).toBe(
      "[2026-09-03T12:00:00.000Z] ERROR: boom\n[2026-09-03T12:00:01.000Z] WARN: careful"
    );
  });
});
