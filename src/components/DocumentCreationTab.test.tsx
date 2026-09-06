/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, act, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentCreationTab from "./DocumentCreationTab";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "mock-toast-id"),
  },
}));

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

let mockConfig = {
  auctionItemsSpreadsheetId: "test-items-spreadsheet-id",
  forPrintFolderId: "test-for-print-folder-id",
};
let mockIsAuctionClosed = false;

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: mockConfig }),
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({ isAuctionClosed: mockIsAuctionClosed }),
}));

const emptyFilesResponse = { ok: true, status: 200, json: async () => [] } as Response;

describe("DocumentCreationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      auctionItemsSpreadsheetId: "test-items-spreadsheet-id",
      forPrintFolderId: "test-for-print-folder-id",
    };
    mockIsAuctionClosed = false;
    mockedFetchWithRetry.mockResolvedValue(emptyFilesResponse);
  });

  it("fetches the For Print folder's files on mount", async () => {
    await act(async () => {
      render(<DocumentCreationTab />);
    });

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining(`/api/drive/files/${mockConfig.forPrintFolderId}`)
    );
  });

  it("shows a 'not configured' placeholder and skips the fetch when forPrintFolderId is missing", async () => {
    mockConfig = { ...mockConfig, forPrintFolderId: "" };

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    expect(screen.getByText("For Print Folder ID not configured.")).toBeInTheDocument();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("renders the fetched files with name, modified date, and an Open button", async () => {
    mockedFetchWithRetry.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: "f1", name: "2026 Auction Catalog.pdf", modifiedTime: "2026-09-01T12:00:00Z", webViewLink: "https://drive.google.com/f1" },
      ],
    } as Response);

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    expect(await screen.findByText("2026 Auction Catalog.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/i })).toBeInTheDocument();
  });

  it("silently shows the empty state (no error toast) when the folder isn't found (404)", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    expect(await screen.findByText("No files found in the For Print folder.")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Refresh Files button re-fetches the folder contents", async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(<DocumentCreationTab />);
    });

    const callsAfterMount = mockedFetchWithRetry.mock.calls.length;
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Refresh files/i }));
    });

    expect(mockedFetchWithRetry.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("disables all 8 generation buttons and shows the closed-auction note when the auction is closed", async () => {
    mockIsAuctionClosed = true;

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    expect(screen.getByText("Auction Closed: Creation tools disabled.")).toBeInTheDocument();
    expect((screen.getByText("Create Bundling Meeting Doc").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Create Live Auction Slideshow").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    // [button's visible text, endpoint, functionName used as the toast id, toast's label text]
    ["Create Bundling Meeting Doc", "/api/production/item-entry/bundling-doc", "apiCreateBundlingDoc", "Create Bundling Meeting Doc"],
    ["Create Item Labels Document", "/api/production/item-entry/item-labels", "apiCreateItemLabels", "Create Item Labels"],
    ["Create Bidding Guide Cover Page", "/api/production/item-entry/bidding-guide-cover", "apiCreateBiddingGuideCoverPage", "Bidding Guide Cover Page"],
    ["Create Bidding Guide Inner Pages", "/api/production/item-entry/bidding-guide-inner", "apiCreateBiddingGuideInnerPages", "Bidding Guide Inner Pages"],
    ["Create Bid Sheets Doc (A5)", "/api/production/item-entry/bid-sheets", "apiCreateBidSheets", "Bid Sheets"],
    ["Create Auction Catalog Doc", "/api/production/item-entry/catalog", "apiCreateCatalog", "Auction Catalog"],
    ["Create Table Tents Doc", "/api/production/item-entry/table-tents", "apiCreateTableTents", "Table Tents"],
    ["Create Live Auction Slideshow", "/api/production/item-entry/slideshow", "apiCreateSlideshow", "Create Slideshow"],
  ])("'%s' POSTs to %s with the configured folderId and spreadsheetId", async (buttonText, endpoint, funcName, toastLabel) => {
    // The generation call itself resolves with a plain success body.
    mockedFetchWithRetry.mockImplementation(async (url: any) => {
      if (typeof url === "string" && url.includes(endpoint)) {
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      return emptyFilesResponse;
    });
    const user = userEvent.setup();

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    await act(async () => {
      await user.click(screen.getByText(buttonText));
    });

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining(endpoint),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ folderId: mockConfig.forPrintFolderId, spreadsheetId: mockConfig.auctionItemsSpreadsheetId }),
      })
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(`${toastLabel} completed!`, { id: funcName });
    });
  });

  it("shows an error toast (not a crash) when generation fails server-side", async () => {
    mockedFetchWithRetry.mockImplementation(async (url: any) => {
      if (typeof url === "string" && url.includes("/bundling-doc")) {
        return { ok: false, status: 400, json: async () => ({ success: false, error: "Auction-Items sheet is empty" }) } as Response;
      }
      return emptyFilesResponse;
    });
    const user = userEvent.setup();

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    await act(async () => {
      await user.click(screen.getByText("Create Bundling Meeting Doc"));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Error: Auction-Items sheet is empty", { id: "apiCreateBundlingDoc" });
    });
  });

  it("shows a configuration error and never calls the endpoint when the Items spreadsheet ID isn't set", async () => {
    mockConfig = { ...mockConfig, auctionItemsSpreadsheetId: "" };
    const user = userEvent.setup();

    await act(async () => {
      render(<DocumentCreationTab />);
    });

    const callsBeforeClick = mockedFetchWithRetry.mock.calls.length;
    await act(async () => {
      await user.click(screen.getByText("Create Bundling Meeting Doc"));
    });

    expect(toast.error).toHaveBeenCalledWith("Please correctly configure the Auction Items Spreadsheet ID in Settings.");
    expect(mockedFetchWithRetry.mock.calls.length).toBe(callsBeforeClick);
  });
});
