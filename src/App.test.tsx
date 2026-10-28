/**
 * @vitest-environment jsdom
 *
 * What App shows each kind of person (ROADMAP A16): a volunteer sees only
 * Bid Management - five tabs, no stage buttons, no Open Spreadsheet - and
 * the thank-you screen once their access ends; a non-admin sent to
 * Settings lands on Bid Management.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("./components/Dashboard", () => ({ default: () => <div>Dashboard page</div> }));
vi.mock("./components/Bidders", () => ({ default: () => <div>Bidders page</div> }));
vi.mock("./components/Items", () => ({ default: () => <div>Items page</div> }));
vi.mock("./components/BidEntry", () => ({ default: () => <div>Bid Entry page</div> }));
vi.mock("./components/Checkout", () => ({ default: () => <div>Checkout page</div> }));
vi.mock("./components/Receipts", () => ({ default: () => <div>Receipts page</div> }));
vi.mock("./components/ConfigSettings", () => ({ default: () => <div>Settings page</div> }));
vi.mock("./components/AuctionTicketsWorkflow", () => ({ default: () => <div>Tickets page</div> }));
vi.mock("./components/AuctionItemsWorkflow", () => ({ default: () => <div>Items workflow page</div> }));
vi.mock("./components/ArchivedAuctionsWorkflow", () => ({ default: () => <div>Archive page</div> }));
vi.mock("./components/BugReportButton", () => ({ BugReportButton: () => null }));
vi.mock("./components/SyncStatusBanner", () => ({ SyncStatusBanner: () => null, SavedBidsSidebarBadge: () => null }));
vi.mock("./hooks/useOutboxReplay", () => ({ useOutboxReplay: () => {} }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

let mockAuth: any;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => mockAuth }));
vi.mock("@/context/ConfigContext", () => ({ useConfig: () => ({ config: { bidManagementSpreadsheetId: "bm" } }) }));
const mockAuction = { auctionState: "prep", isAuctionClosed: false, isBidManagementSetUp: true, closeAuction: vi.fn(), goLive: vi.fn() };
vi.mock("./context/AuctionContext", () => ({ useAuction: () => mockAuction }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => mockAuction }));

import App from "./App";

const signedIn = (role: string, capabilities: string[]) => ({
  authenticated: true,
  user: { email: role === "volunteer" ? "pat@gmail.com" : "sam@orns.org", role, roleLabel: role, capabilities },
  can: (c: string) => capabilities.includes(c),
  signedOutReason: null,
  handleLogin: vi.fn(),
  handleLogout: vi.fn(),
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("App - a volunteer", () => {
  beforeEach(() => {
    // A volunteer whose browser remembers Settings and the Items tab from a staff sign-in.
    localStorage.setItem("activeWorkflow", "settings");
    localStorage.setItem("activeBidTab", "items");
    mockAuth = signedIn("volunteer", []);
  });

  it("sees only Bid Management: five tabs, no stage buttons, no Open Spreadsheet", async () => {
    render(<App />);

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Settings page")).toBeNull();
    expect(screen.queryByText("Items page")).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Dashboard", "Bidders", "Bid Entry", "Checkout", "Receipts"]);
    expect(screen.queryByRole("button", { name: /Go Live/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Spreadsheet/ })).toBeNull();
    expect(window.location.pathname).toBe("/BidManagement");
  });

  it("has only Bid Management in the sidebar", () => {
    render(<App />);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByTitle("Bid Management")).toBeInTheDocument();
    for (const title of ["Auction Items", "Auction Tickets", "Archived Auctions", "Settings"]) {
      expect(within(sidebar).queryByTitle(title)).toBeNull();
    }
  });

  it("sees the thank-you screen once their access has ended", () => {
    mockAuth = { ...signedIn("volunteer", []), authenticated: false, user: null, signedOutReason: "volunteer_access_ended" };
    render(<App />);
    expect(screen.getByText("Thanks for volunteering!")).toBeInTheDocument();
    expect(screen.queryByText(/Sign in with @orns.org/)).toBeNull();
  });
});

describe("App - staff", () => {
  it("sends someone without the Settings permission to Bid Management, never showing Settings", async () => {
    window.history.replaceState(null, "", "/Settings");
    mockAuth = signedIn("user", []);
    render(<App />);

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Settings page")).toBeNull();
    expect(window.location.pathname).toBe("/BidManagement");
  });

  it("shows a Full Administrator Settings, and the stage buttons and Items tab in Bid Management", async () => {
    window.history.replaceState(null, "", "/Settings");
    mockAuth = signedIn("full_admin", ["settings", "auction.stage"]);
    const { unmount } = render(<App />);
    expect(await screen.findByText("Settings page")).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/BidManagement");
    render(<App />);
    expect(await screen.findByRole("button", { name: /Go Live/ })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toContain("Items");
  });
});
