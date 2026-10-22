/**
 * @vitest-environment jsdom
 *
 * The connection banner (Milestone A), driven by the real retry-status
 * and outbox stores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/google-api", () => ({ fetchWithRetry: vi.fn(), getBaseUrl: () => "" }));

import { fetchWithRetry } from "@/services/google-api";
import { SyncStatusBanner, SavedBidsSidebarBadge } from "./SyncStatusBanner";
import { addToOutbox, flushOutbox, markNeedsSignIn, RecordWinningBidBody, _resetOutboxForTesting } from "@/lib/bidOutbox";
import { newRequestId, reportDone, reportRetry, _resetRetryStatusForTesting } from "@/lib/syncStatus";

const bid = (n: number): RecordWinningBidBody => ({
  bidderId: "142", itemId: String(1300 + n), price: 100, spreadsheetId: "ss",
  bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", idempotencyKey: `k${n}`,
});
const display = { bidderName: "Maria Lopez", itemName: "Cabin Weekend" };

let online = true;
function goOffline() {
  online = false;
  window.dispatchEvent(new Event("offline"));
}

describe("SyncStatusBanner", () => {
  beforeEach(() => {
    _resetOutboxForTesting();
    _resetRetryStatusForTesting();
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    vi.mocked(fetchWithRetry).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows nothing when everything is normal, but keeps the live region in place", () => {
    render(<SyncStatusBanner onSignIn={() => {}} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says Google is slow while a request is retrying, then that it's responding again", () => {
    render(<SyncStatusBanner onSignIn={() => {}} />);
    const id = newRequestId();
    act(() => reportRetry(id, 2, 4));
    expect(screen.getByRole("status")).toHaveTextContent("Google Sheets is slow to respond. Retrying (attempt 2 of 4)");
    act(() => reportDone(id, true));
    expect(screen.getByRole("status")).toHaveTextContent("Google Sheets is responding again.");
  });

  it("says the connection is gone, with how many bids are saved", () => {
    render(<SyncStatusBanner onSignIn={() => {}} />);
    act(() => {
      addToOutbox(bid(1), display);
      addToOutbox(bid(2), display);
      goOffline();
    });
    expect(screen.getByRole("status")).toHaveTextContent("No internet connection. 2 bids saved on this device.");
  });

  it("asks for a fresh sign-in when that's what's holding saved bids back", async () => {
    const onSignIn = vi.fn();
    render(<SyncStatusBanner onSignIn={onSignIn} />);
    act(() => {
      addToOutbox(bid(1), display);
      markNeedsSignIn();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Your sign-in has expired. 1 bid saved on this device.");
    await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it("lists refused bids with the server's reason, and lets staff remove one", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Item #1301 already has a winning bid (bidder 87, $650.00), so this bid wasn't recorded." }) } as Response);
    render(<SyncStatusBanner onSignIn={() => {}} />);
    await act(async () => {
      addToOutbox(bid(1), display);
      await flushOutbox();
    });

    expect(screen.getByRole("status")).toHaveTextContent("1 saved bid couldn't be recorded.");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/already has a winning bid \(bidder 87/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(/couldn't be recorded/)).not.toBeInTheDocument();
  });

  it("confirms once every saved bid has been sent", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
    render(<SyncStatusBanner onSignIn={() => {}} />);
    await act(async () => {
      addToOutbox(bid(1), display);
      await flushOutbox();
    });
    expect(screen.getByRole("status")).toHaveTextContent("All saved bids sent.");
  });
});

describe("SavedBidsSidebarBadge", () => {
  beforeEach(() => _resetOutboxForTesting());

  it("shows the waiting count, and nothing when the outbox is empty", () => {
    const { container } = render(<SavedBidsSidebarBadge expanded />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      addToOutbox(bid(1), display);
    });
    expect(screen.getByText("1 bid waiting")).toBeInTheDocument();
  });
});
