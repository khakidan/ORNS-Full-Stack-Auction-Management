/**
 * @vitest-environment jsdom
 *
 * The Bid Management page's stage buttons (ROADMAP T7): Set Up, Go Live
 * and Close. The tab pages are tested on their own, so they're placeholders
 * here; the Set Up request is the API seam.
 */
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import BidManagementWorkflow from "./BidManagementWorkflow";
import { postJsonOnce, HttpError } from "@/services/apiClient";
import { toast } from "sonner";

vi.mock("./Dashboard", () => ({ default: () => null }));
vi.mock("./Bidders", () => ({ default: () => null }));
vi.mock("./Items", () => ({ default: () => null }));
vi.mock("./BidEntry", () => ({ default: () => null }));
vi.mock("./Checkout", () => ({ default: () => null }));
vi.mock("./Receipts", () => ({ default: () => null }));

vi.mock("@/services/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/apiClient")>()),
  postJsonOnce: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "setup-toast") } }));

let canStage = true;
let auction: { auctionState: string; isAuctionClosed: boolean; isBidManagementSetUp: boolean | null; goLive: () => void; closeAuction: () => void };
vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: { bidManagementSpreadsheetId: "bm-sheet", auctionTicketsSpreadsheetId: "tickets-sheet" } }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: (cap: string) => cap !== "auction.stage" || canStage }) }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => auction }));

const page = () => render(<BidManagementWorkflow activeBidTab="dashboard" onBidTabChange={() => {}} isVolunteer={false} />);
const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  canStage = true;
  auction = { auctionState: "prep", isAuctionClosed: false, isBidManagementSetUp: true, goLive: vi.fn(), closeAuction: vi.fn() };
  vi.stubGlobal("location", { ...window.location, reload });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Set Up Bid Management App", () => {
  beforeEach(() => { auction.isBidManagementSetUp = false; });

  /** The delay the page waits before reloading, and that waiting runs the reload. */
  async function reloadDelayAfter(click: () => Promise<void>) {
    const timers = vi.spyOn(window, "setTimeout");
    await click();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const scheduled = timers.mock.calls.find(([, delay]) => delay === 1500 || delay === 6000);
    expect(reload).not.toHaveBeenCalled();
    (scheduled![0] as () => void)();
    expect(reload).toHaveBeenCalledTimes(1);
    return scheduled![1];
  }

  it("sends the Config's two spreadsheets once, shows the ticket price message, and reloads after time to read it", async () => {
    vi.mocked(postJsonOnce).mockResolvedValue({ bidders: 12, ticketPrice: { outcome: "updated", message: "Ticket price changed from $30 to $35 to match the website." } });
    const user = userEvent.setup();
    page();

    const delay = await reloadDelayAfter(() => user.click(screen.getByRole("button", { name: "Set Up Bid Management App" })));

    expect(postJsonOnce).toHaveBeenCalledTimes(1);
    expect(postJsonOnce).toHaveBeenCalledWith("/api/bidders/sync", { spreadsheetId: "bm-sheet", auctionTicketSheetsID: "tickets-sheet" }, "Failed to setup bid management app");
    expect(toast.success).toHaveBeenCalledWith(expect.any(String), { id: "setup-toast", description: "Ticket price changed from $30 to $35 to match the website." });
    expect(delay).toBe(6000);
  });

  it("reloads sooner when the price was already right", async () => {
    vi.mocked(postJsonOnce).mockResolvedValue({ ticketPrice: { outcome: "unchanged", message: "Ticket price matches the website ($35)." } });
    const user = userEvent.setup();
    page();

    expect(await reloadDelayAfter(() => user.click(screen.getByRole("button", { name: "Set Up Bid Management App" })))).toBe(1500);
  });

  it("can't be sent twice while it runs", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(postJsonOnce).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    page();

    await user.click(screen.getByRole("button", { name: "Set Up Bid Management App" }));
    const busy = screen.getByRole("button", { name: "Setting up..." });
    expect(busy).toBeDisabled();
    await user.click(busy);

    expect(postJsonOnce).toHaveBeenCalledTimes(1);
    await act(async () => { finish({}); });
  });

  it("shows the server's reason and doesn't reload when it fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(postJsonOnce).mockRejectedValue(new HttpError("Missing 'Bidder-Numbers'", 400, {}));
    const user = userEvent.setup();
    page();

    await user.click(screen.getByRole("button", { name: "Set Up Bid Management App" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Missing 'Bidder-Numbers'", { id: "setup-toast" }));
    expect(screen.getByRole("button", { name: "Set Up Bid Management App" })).toBeEnabled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("Go Live and Close", () => {
  it("Go Live asks first, and does nothing if the person cancels", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    page();

    await user.click(screen.getByRole("button", { name: "Go Live" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Take the auction LIVE"));
    expect(auction.goLive).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Go Live" }));
    expect(auction.goLive).toHaveBeenCalledTimes(1);
  });

  it("Go Live isn't offered until Bid Management is set up", () => {
    auction.isBidManagementSetUp = false;
    page();
    expect(screen.queryByRole("button", { name: "Go Live" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Up Bid Management App" })).toBeInTheDocument();
  });

  it("Close asks first, and does nothing if the person cancels", async () => {
    auction.auctionState = "live";
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    page();

    await user.click(screen.getByRole("button", { name: "Close Auction" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("CLOSE the auction"));
    expect(auction.closeAuction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Close Auction" }));
    expect(auction.closeAuction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["prep, set up", { auctionState: "prep", isBidManagementSetUp: true }],
    ["prep, not set up", { auctionState: "prep", isBidManagementSetUp: false }],
    ["live", { auctionState: "live", isBidManagementSetUp: true }],
  ])("offers no stage buttons without auction.stage (%s)", (_label, state) => {
    canStage = false;
    Object.assign(auction, state);
    page();
    for (const name of ["Go Live", "Close Auction", "Set Up Bid Management App"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("offers no stage buttons once the auction is closed", () => {
    Object.assign(auction, { auctionState: "closed", isAuctionClosed: true });
    page();
    for (const name of ["Go Live", "Close Auction", "Set Up Bid Management App"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
