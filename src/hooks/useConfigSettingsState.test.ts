/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { extractId, useConfigSettingsState } from "./useConfigSettingsState";
import { useConfig } from "@/context/ConfigContext";
import { Config } from "@/types";

describe("extractId", () => {
  it("returns an empty string for empty/undefined input", () => {
    expect(extractId("")).toBe("");
    expect(extractId(undefined as unknown as string)).toBe("");
  });

  it("returns a bare, already-clean ID unchanged (trimmed)", () => {
    expect(extractId("1AbC-XyZ_123")).toBe("1AbC-XyZ_123");
    expect(extractId("  1AbC-XyZ_123  ")).toBe("1AbC-XyZ_123");
  });

  it("extracts a script ID from an Apps Script project editor URL", () => {
    const url = "https://script.google.com/home/projects/1AbC-XyZ_123/edit";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("extracts a spreadsheet/doc ID from a /d/ URL", () => {
    const url = "https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit#gid=0";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("extracts a folder ID from a Drive /folders/ URL", () => {
    const url = "https://drive.google.com/drive/folders/1AbC-XyZ_123";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("extracts an ID from an id= query parameter", () => {
    const url = "https://drive.google.com/open?id=1AbC-XyZ_123";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("prefers the /d/ pattern over a coincidental 'id=' substring elsewhere in the same URL", () => {
    // "#gid=0" itself contains the substring "id=" - if the /d/ branch's
    // own regex ever stopped matching, this would silently fall through
    // to the id= branch and extract "0" instead of the real spreadsheet ID.
    const url = "https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit#gid=0";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
    expect(extractId(url)).not.toBe("0");
  });

  it("extracts a folder ID even when the URL also has an unrelated id=-shaped query param", () => {
    const url = "https://drive.google.com/drive/folders/1AbC-XyZ_123?resourcekey=id%3Dxyz";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("falls back to the raw trimmed input when no known Google URL pattern matches", () => {
    expect(extractId("not-a-url-just-an-id")).toBe("not-a-url-just-an-id");
    expect(extractId("  https://example.com/unrelated  ")).toBe("https://example.com/unrelated");
  });
});

vi.mock("@/context/ConfigContext", () => ({
  useConfig: vi.fn(),
}));

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

const BASE_CONFIG: Config = {
  auctionItemsSpreadsheetId: "mock-items-id",
  auctionTicketsSpreadsheetId: "mock-tickets-id",
  bidManagementSpreadsheetId: "mock-bid-mgt-id",
  bidderNumbersSheet: "Bidder-Numbers",
  auctionItemsSheet: "Auction-Items",
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "mock-receipts-folder",
  forPrintFolderId: "mock-print-folder",
  ornsLogoId: "mock-logo-id",
  ticketPrice: "35",
  auctionItemsScriptId: "mock-items-script",
  auctionTicketsScriptId: "mock-tickets-script",
  bidManagementScriptId: "mock-bid-mgt-script",
  bugReportsSpreadsheetId: "mock-bug-reports-id",
  bugReportsFolderId: "mock-bug-reports-folder",
};

function mockUseConfig(config: Config) {
  vi.mocked(useConfig).mockReturnValue({
    config,
    saveConfig: vi.fn().mockResolvedValue(undefined),
    firebaseUser: null,
    loginToFirebase: vi.fn(),
    loading: false,
  } as any);
}

describe("useConfigSettingsState - local draft sync from remoteConfig", () => {
  beforeEach(() => {
    mockUseConfig(BASE_CONFIG);
  });

  it("initializes the local draft from remoteConfig", () => {
    const { result } = renderHook(() => useConfigSettingsState());
    expect(result.current.config).toEqual(BASE_CONFIG);
  });

  it("picks up a real remoteConfig change while the draft is still clean, e.g. the initial async Firestore load arriving after mount", () => {
    const { result, rerender } = renderHook(() => useConfigSettingsState());

    const LOADED_CONFIG: Config = { ...BASE_CONFIG, ticketPrice: "50" };
    mockUseConfig(LOADED_CONFIG);
    rerender();

    expect(result.current.config.ticketPrice).toBe("50");
  });

  it("does NOT clobber an in-progress local edit when remoteConfig changes again - the exact bug the unconditional sync effect used to cause", () => {
    const { result, rerender } = renderHook(() => useConfigSettingsState());

    act(() => {
      result.current.setConfig({ ...result.current.config, ticketPrice: "99" });
    });
    expect(result.current.config.ticketPrice).toBe("99");

    // A same-identity Firestore re-fire, or a genuine change from another
    // admin's device, arriving while this user still has an unsaved edit.
    const EXTERNAL_CONFIG: Config = { ...BASE_CONFIG, receiptFolderId: "someone-elses-change" };
    mockUseConfig(EXTERNAL_CONFIG);
    rerender();

    // The user's own in-progress edit must survive.
    expect(result.current.config.ticketPrice).toBe("99");
  });

  it("keeps syncing across multiple consecutive remoteConfig changes as long as the draft is never touched - not a sync-exactly-once bug", () => {
    const { result, rerender } = renderHook(() => useConfigSettingsState());

    const FIRST_LOAD: Config = { ...BASE_CONFIG, ticketPrice: "50" };
    mockUseConfig(FIRST_LOAD);
    rerender();
    expect(result.current.config.ticketPrice).toBe("50");

    const SECOND_UPDATE: Config = { ...BASE_CONFIG, ticketPrice: "65" };
    mockUseConfig(SECOND_UPDATE);
    rerender();
    expect(result.current.config.ticketPrice).toBe("65");
  });
});
