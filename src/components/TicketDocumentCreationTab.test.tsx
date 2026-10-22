/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TicketDocumentCreationTab from "./TicketDocumentCreationTab";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "mock-toast-id"),
  },
}));

// The real errorTextFrom/ServerUnreachableError/NO_ANSWER_MESSAGE are
// kept; only the two network calls are mocked. Document runs go through
// postOnce (sent once, never retried); fetchWithRetry is only the folder
// file list here.
vi.mock("@/services/google-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/google-api")>()),
  fetchWithRetry: vi.fn(),
  postOnce: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

import { fetchWithRetry, postOnce, ServerUnreachableError, NO_ANSWER_MESSAGE } from "@/services/google-api";
import { toast } from "sonner";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);
const mockedPostOnce = vi.mocked(postOnce);

let mockConfig = {
  auctionTicketsSpreadsheetId: "test-tickets-spreadsheet-id",
  forPrintFolderId: "test-for-print-folder-id",
  bidManagementSpreadsheetId: "test-bid-management-id",
};
let mockIsAuctionClosed = false;

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: mockConfig }),
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({ isAuctionClosed: mockIsAuctionClosed }),
}));

const emptyFilesResponse = { ok: true, status: 200, json: async () => [] } as Response;

describe("TicketDocumentCreationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      auctionTicketsSpreadsheetId: "test-tickets-spreadsheet-id",
      forPrintFolderId: "test-for-print-folder-id",
      bidManagementSpreadsheetId: "test-bid-management-id",
    };
    mockIsAuctionClosed = false;
    mockedFetchWithRetry.mockResolvedValue(emptyFilesResponse);
  });

  it("POSTs to bidder-labels with folderId, bidManagementSpreadsheetId, and auctionTicketsSpreadsheetId from config", async () => {
    mockedPostOnce.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketDocumentCreationTab />);
    });

    await act(async () => {
      await user.click(screen.getByText("Create Bidder Labels Doc"));
    });

    expect(postOnce).toHaveBeenCalledTimes(1);
    expect(postOnce).toHaveBeenCalledWith(
      expect.stringContaining("/api/production/tickets/bidder-labels"),
      {
        folderId: mockConfig.forPrintFolderId,
        bidManagementSpreadsheetId: mockConfig.bidManagementSpreadsheetId,
        auctionTicketsSpreadsheetId: mockConfig.auctionTicketsSpreadsheetId,
      }
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Create Bidder Labels completed!", { id: "apiCreateBidderLabels" });
    });
  });

  it("shows a configuration error and never calls the endpoint when the Tickets spreadsheet ID isn't set", async () => {
    mockConfig = { ...mockConfig, auctionTicketsSpreadsheetId: "" };
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketDocumentCreationTab />);
    });

    const callsBeforeClick = mockedFetchWithRetry.mock.calls.length;
    await act(async () => {
      await user.click(screen.getByText("Create Bidder Labels Doc"));
    });

    expect(toast.error).toHaveBeenCalledWith("Please correctly configure the Auction Tickets Spreadsheet ID in Settings.");
    expect(mockedFetchWithRetry.mock.calls.length).toBe(callsBeforeClick);
    expect(postOnce).not.toHaveBeenCalled();
  });

  it("shows a configuration error and never calls the endpoint when the Bid Management spreadsheet ID isn't set", async () => {
    mockConfig = { ...mockConfig, bidManagementSpreadsheetId: "" };
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketDocumentCreationTab />);
    });

    const callsBeforeClick = mockedFetchWithRetry.mock.calls.length;
    await act(async () => {
      await user.click(screen.getByText("Create Bidder Labels Doc"));
    });

    expect(toast.error).toHaveBeenCalledWith("Please correctly configure the Bid Management Spreadsheet ID in Settings.");
    expect(mockedFetchWithRetry.mock.calls.length).toBe(callsBeforeClick);
    expect(postOnce).not.toHaveBeenCalled();
  });

  it("surfaces the hard-error message (e.g. unmatched bidders) as an error toast, not a crash", async () => {
    mockedPostOnce.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: "The following people could not be matched to a Bidder-Numbers entry: Ghost Person." }),
    } as Response);
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketDocumentCreationTab />);
    });

    await act(async () => {
      await user.click(screen.getByText("Create Bidder Labels Doc"));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Error: The following people could not be matched to a Bidder-Numbers entry: Ghost Person.",
        { id: "apiCreateBidderLabels" }
      );
    });
  });

  it("disables the generation button and shows the closed-auction note when the auction is closed", async () => {
    mockIsAuctionClosed = true;

    await act(async () => {
      render(<TicketDocumentCreationTab />);
    });

    expect(screen.getByText("Auction Closed: Creation tools disabled.")).toBeInTheDocument();
    expect((screen.getByText("Create Bidder Labels Doc").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
