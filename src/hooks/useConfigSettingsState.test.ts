/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { extractId, useConfigSettingsState } from "./useConfigSettingsState";
import { useConfig } from "@/context/ConfigContext";
import { postOnce } from "@/services/google-api";
import { toast } from "sonner";
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
  postOnce: vi.fn(),
  errorTextFrom: (data: any, fallback: string) => data?.message || data?.error || fallback,
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
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "mock-receipts-folder",
  forPrintFolderId: "mock-print-folder",
  ornsLogoId: "mock-logo-id",
  ticketPrice: "35",
  ticketPriceFromWebsiteAt: "",
  auctionItemsScriptId: "mock-items-script",
  auctionTicketsScriptId: "mock-tickets-script",
  bidManagementScriptId: "mock-bid-mgt-script",
  bugReportsSpreadsheetId: "mock-bug-reports-id",
  bugReportsFolderId: "mock-bug-reports-folder",
  paypalIsSandbox: true,
};

function mockUseConfig(config: Config, overrides: Record<string, unknown> = {}) {
  vi.mocked(useConfig).mockReturnValue({
    config,
    saveConfig: vi.fn().mockResolvedValue(undefined),
    reloadConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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

describe("useConfigSettingsState - Setup New Auction Year (ROADMAP A5)", () => {
  /** The setup route's NDJSON stream: one log line, then the result. */
  function streamOf(result: Record<string, unknown>) {
    const lines = [JSON.stringify({ log: "Starting setup" }), JSON.stringify(result)].map((l) => new TextEncoder().encode(l + "\n"));
    let i = 0;
    return { ok: true, body: { getReader: () => ({ read: async () => (i < lines.length ? { value: lines[i++], done: false } : { value: undefined, done: true }) }) } } as unknown as Response;
  }
  const RESULT = { success: true, auctionYear: 2027, bidderReceiptsFolderId: "new-receipts", forPrintFolderId: "new-print" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("leaves saving the new folders to the server and reloads the Config, instead of saving from the browser", async () => {
    const saveConfig = vi.fn();
    const reloadConfig = vi.fn().mockResolvedValue(undefined);
    mockUseConfig(BASE_CONFIG, { saveConfig, reloadConfig });
    vi.mocked(postOnce).mockResolvedValue(streamOf(RESULT));
    const { result } = renderHook(() => useConfigSettingsState());

    await act(() => result.current.handleSetupNewAuction());

    expect(saveConfig).not.toHaveBeenCalled();
    expect(reloadConfig).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("gives a draft with unsaved edits the new folders, so saving it later can't put last year's back", async () => {
    mockUseConfig(BASE_CONFIG);
    vi.mocked(postOnce).mockResolvedValue(streamOf(RESULT));
    const { result } = renderHook(() => useConfigSettingsState());
    act(() => result.current.setConfig({ ...result.current.config, ticketPrice: "99" }));

    await act(() => result.current.handleSetupNewAuction());

    expect(result.current.config).toMatchObject({ ticketPrice: "99", receiptFolderId: "new-receipts", forPrintFolderId: "new-print" });
  });

  it("sends the setup once, and shows the server's reason when it's refused (already running - ROADMAP A17)", async () => {
    mockUseConfig(BASE_CONFIG);
    vi.mocked(postOnce).mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Setting up the new auction year is already running. Wait for it to finish." }) } as Response);
    const { result } = renderHook(() => useConfigSettingsState());

    await act(() => result.current.handleSetupNewAuction());

    expect(postOnce).toHaveBeenCalledTimes(1);
    expect(postOnce).toHaveBeenCalledWith("http://localhost:3000/api/auction/setup-new", expect.objectContaining({ bidManagementSpreadsheetId: "mock-bid-mgt-id" }));
    expect(toast.error).toHaveBeenCalledWith("Setting up the new auction year is already running. Wait for it to finish.", expect.anything());
  });

  it("shows the server's message, and doesn't touch the draft, when the server couldn't save the folders", async () => {
    mockUseConfig(BASE_CONFIG);
    vi.mocked(postOnce).mockResolvedValue(streamOf({ ...RESULT, configSaveError: "Set Receipts Folder ID to new-receipts" }));
    const { result } = renderHook(() => useConfigSettingsState());
    act(() => result.current.setConfig({ ...result.current.config, ticketPrice: "99" }));

    await act(() => result.current.handleSetupNewAuction());

    expect(toast.error).toHaveBeenCalledWith("Set Receipts Folder ID to new-receipts", expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.config.receiptFolderId).toBe("mock-receipts-folder");
  });
});
