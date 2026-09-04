/**
 * @vitest-environment jsdom
 *
 * useBugReportState is only ever consumed through BugReportButton.tsx,
 * so exercised directly via renderHook - the app-wide contexts it reads
 * (AuctionContext/ConfigContext) and its side-effect modules
 * (screenshotCapture/errorBuffer) are mocked at the module boundary,
 * matching the pattern already used for other hooks hidden behind a
 * fully-mocked context in this codebase's own test suite.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useBugReportState } from "./useBugReportState";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/screenshotCapture", () => ({
  captureScreenshot: vi.fn(),
  blobToBase64: vi.fn(),
}));

vi.mock("@/lib/errorBuffer", () => ({
  getErrorBuffer: vi.fn(() => [{ level: "error", message: "prior failure", timestamp: "2026-09-03T00:00:00.000Z" }]),
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    bidders: [{}, {}],
    items: [{}, {}, {}],
    attendees: [{}],
    winners: { "101": "item1" },
    isAuctionClosed: false,
  }),
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      bidManagementSpreadsheetId: "bid-mgmt-id",
      auctionItemsSpreadsheetId: "",
      auctionTicketsSpreadsheetId: "tickets-id",
      bugReportsSpreadsheetId: "bug-reports-id",
      bugReportsFolderId: "bug-folder-id",
    },
  }),
}));

import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";
import { captureScreenshot, blobToBase64 } from "@/lib/screenshotCapture";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);
const mockedCaptureScreenshot = vi.mocked(captureScreenshot);
const mockedBlobToBase64 = vi.mocked(blobToBase64);

describe("useBugReportState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
  });

  it("opens the dialog on the Ctrl/Cmd+Shift+B keyboard shortcut from anywhere in the app", () => {
    const { result } = renderHook(() => useBugReportState());
    expect(result.current.open).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true }));
    });

    expect(result.current.open).toBe(true);
  });

  it("rejects submission with an empty title or description, without ever calling fetch", async () => {
    const { result } = renderHook(() => useBugReportState());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(toast.error).toHaveBeenCalledWith("Title and description are required");
    expect(mockedFetchWithRetry).not.toHaveBeenCalled();
  });

  it("posts the full auto-captured context alongside the form fields, and closes/resets on success", async () => {
    const { result } = renderHook(() => useBugReportState());

    act(() => {
      result.current.setForm({ title: "  Broken button  ", description: "  It does nothing  ", type: "UI Issue", includeScreenshot: false });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1);
    const [url, options] = mockedFetchWithRetry.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/bug-reports");
    const body = JSON.parse((options as RequestInit).body as string);

    expect(body.title).toBe("Broken button");
    expect(body.description).toBe("It does nothing");
    expect(body.type).toBe("UI Issue");
    expect(body.screenshotBase64).toBeNull();
    expect(body.appState).toContain("Bidders: 2");
    expect(body.appState).toContain("Items: 3");
    expect(body.appState).toContain("Attendees: 1");
    expect(body.appState).toContain("Winners recorded: 1");
    expect(body.consoleActivity).toEqual([{ level: "error", message: "prior failure", timestamp: "2026-09-03T00:00:00.000Z" }]);
    expect(body.bugReportsSpreadsheetId).toBe("bug-reports-id");
    expect(body.bugReportsFolderId).toBe("bug-folder-id");

    expect(toast.success).toHaveBeenCalledWith("Bug report saved");
    expect(result.current.open).toBe(false);
    expect(result.current.form.title).toBe("");
  });

  it("captures and base64-encodes a screenshot only when includeScreenshot is checked", async () => {
    mockedCaptureScreenshot.mockResolvedValue(new Blob(["fake"]));
    mockedBlobToBase64.mockResolvedValue("ZmFrZQ==");

    const { result } = renderHook(() => useBugReportState());
    act(() => {
      result.current.setForm({ title: "T", description: "D", type: "Bug", includeScreenshot: true });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockedCaptureScreenshot).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockedFetchWithRetry.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screenshotBase64).toBe("ZmFrZQ==");
  });

  it("still saves the report when the best-effort screenshot capture fails (returns null)", async () => {
    mockedCaptureScreenshot.mockResolvedValue(null);

    const { result } = renderHook(() => useBugReportState());
    act(() => {
      result.current.setForm({ title: "T", description: "D", type: "Bug", includeScreenshot: true });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockedBlobToBase64).not.toHaveBeenCalled();
    const body = JSON.parse((mockedFetchWithRetry.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screenshotBase64).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Bug report saved");
  });

  it("shows an error toast and keeps the dialog open (and form intact) when the save itself fails", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, json: async () => ({ error: "disk full" }) } as Response);

    const { result } = renderHook(() => useBugReportState());
    act(() => {
      result.current.setOpen(true);
      result.current.setForm({ title: "T", description: "D", type: "Bug", includeScreenshot: false });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(toast.error).toHaveBeenCalledWith("disk full");
    expect(result.current.open).toBe(true);
    expect(result.current.form.title).toBe("T");
  });
});
