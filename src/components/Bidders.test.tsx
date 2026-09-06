/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Bidders from "./Bidders";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Framer Motion Mock as established in other tests
vi.mock("motion/react", () => ({
  motion: new Proxy({}, {
    get: (_target, tag) =>
      ({ children, ...props }: any) => {
        const { createElement } = require("react");
        return createElement(String(tag), props, children);
      }
  }),
  AnimatePresence: ({ children }: any) => children,
}));

// Mock standard select component as a native HTML select element for easy and reliable testing
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select 
      value={value} 
      onChange={(e) => {
        onValueChange(e.target.value);
      }}
      data-testid="mock-select"
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="" disabled>{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

// Mock Dialog & AlertDialog components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div data-testid="mock-dialog">{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div data-testid="mock-alert-dialog">{children}</div>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  // Forward onClick - a prior version of this mock dropped it entirely,
  // which would silently no-op any test that clicks a confirm/cancel
  // button in a dialog built on these primitives (see refactor-opportunities.md).
  AlertDialogCancel: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

// Mock ScrollArea component
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// Sonner Toast Mock
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "mock-toast-id"),
  },
}));

// Google-api mock
vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  updateSheetData: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  getSheetData: vi.fn(),
  appendSheetData: vi.fn(),
}));

import { toast } from "sonner";
import { fetchWithRetry } from "@/services/google-api";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

// Mock dataset of 6 bidders covering all target filter states:
// - 2 checked in (John Doe, Jane Smith)
// - 2 not checked in (Alice Green, Bob White)
// - 2 proxy (Charlie Brown, David Black)
const mockBidders = [
  {
    id: "101",
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    checkedIn: true,
    isProxy: false,
    checkedOut: false,
    paid: false,
  },
  {
    id: "102",
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@example.com",
    checkedIn: true,
    isProxy: false,
    checkedOut: false,
    paid: false,
  },
  {
    id: "103",
    firstName: "Alice",
    lastName: "Green",
    email: "alice@example.com",
    checkedIn: false,
    isProxy: false,
    checkedOut: false,
    paid: false,
  },
  {
    id: "104",
    firstName: "Bob",
    lastName: "White",
    email: "bob@example.com",
    checkedIn: false,
    isProxy: false,
    checkedOut: false,
    paid: false,
  },
  {
    id: "105",
    firstName: "Charlie",
    lastName: "Brown",
    email: "charlie@example.com",
    checkedIn: false,
    isProxy: true,
    checkedOut: false,
    paid: false,
  },
  {
    id: "106",
    firstName: "David",
    lastName: "Black",
    email: "david@example.com",
    checkedIn: false,
    isProxy: true,
    checkedOut: false,
    paid: false,
  },
  {
    id: "107",
    firstName: "Eve",
    lastName: "Taylor",
    email: "eve@example.com",
    checkedIn: true,
    isProxy: false,
    checkedOut: true,
    paid: false,
  },
  {
    id: "108",
    firstName: "Frank",
    lastName: "Miller",
    email: "frank@example.com",
    checkedIn: true,
    isProxy: false,
    checkedOut: true,
    paid: true,
  },
];

// Mock dataset of matching attendees to control payment filter & source filter status:
// - John Doe: Paid, registered (matches sponsor tickets sheet)
// - Jane Smith: Pending, registered (matches staff tickets sheet)
// - Charlie Brown: Paid, registered (matches sponsor tickets sheet)
// - David Black: Pending, registered (matches staff tickets sheet)
// (Alice Green & Bob White do not have matching attendee records, so they represent walk-ins/unregistered with unpaid status)
const mockAttendees = [
  {
    id: "att-1",
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    phone: "111-111-1111",
    sheet: "sponsor tickets",
    paymentStatus: "Paid",
    guestsInfo: []
  },
  {
    id: "att-2",
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@example.com",
    phone: "222-222-2222",
    sheet: "staff tickets",
    paymentStatus: "Pending",
    guestsInfo: []
  },
  {
    id: "att-5",
    firstName: "Charlie",
    lastName: "Brown",
    email: "charlie@example.com",
    phone: "555-555-5555",
    sheet: "sponsor tickets",
    paymentStatus: "Paid",
    guestsInfo: []
  },
  {
    id: "att-6",
    firstName: "David",
    lastName: "Black",
    email: "david@example.com",
    phone: "666-666-6666",
    sheet: "staff tickets",
    paymentStatus: "Pending",
    guestsInfo: []
  },
];

// Stable across renders (unlike a fresh vi.fn() created inside the mock
// factory below, which would produce a new, unassertable reference on
// every re-render) so tests can assert on them directly.
const mockCheckInBidder = vi.fn();
const mockMarkBidderAsProxy = vi.fn();
const mockFetchBidders = vi.fn();
const mockFetchAttendees = vi.fn();

// Per-test overrides for the two context mocks below - null means "use
// the shared default dataset used by every existing test in this file".
// Reset to null in the top-level afterEach so an override never leaks
// into a later, unrelated test.
let authOverride: any = null;
let configOverride: any = null;

// Mock Config & Auction contexts
vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => configOverride ?? {
    config: {
      bidManagementSpreadsheetId: "test-bid-mgmt-id",
      auctionTicketsSpreadsheetId: "test-tickets-id",
      ticketPrice: "35",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
    }
  }
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => authOverride ?? {
    bidders: mockBidders,
    attendees: mockAttendees,
    loading: false,
    checkInBidder: mockCheckInBidder,
    markBidderAsProxy: mockMarkBidderAsProxy,
    fetchBidders: mockFetchBidders,
    fetchAttendees: mockFetchAttendees,
    isAuctionClosed: false,
  }
}));

afterEach(() => {
  authOverride = null;
  configOverride = null;
});

describe('Bidders - Sort and Filter', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it('Check-in status filter — checked in: Assert only checked-in bidders are visible', async () => {
    render(<Bidders />);
    
    const selects = screen.getAllByTestId("mock-select");
    const statusSelect = selects[0];

    // Select "Checked In" status ('checked-in')
    await user.selectOptions(statusSelect, "checked-in");

    // John Doe and Jane Smith should be visible
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();

    // Alice, Bob, Charlie, and David should not be visible
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob White")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    expect(screen.queryByText("David Black")).not.toBeInTheDocument();
  });

  it('Check-in status filter — not checked in: Assert only non-checked-in bidders are visible', async () => {
    render(<Bidders />);
    
    const selects = screen.getAllByTestId("mock-select");
    const statusSelect = selects[0];

    // Select "Pending" status ('pending' matches non-checked-in and non-proxy)
    await user.selectOptions(statusSelect, "pending");

    // Alice Green and Bob White should be visible
    expect(screen.getByText("Alice Green")).toBeInTheDocument();
    expect(screen.getByText("Bob White")).toBeInTheDocument();

    // John, Jane, Charlie, and David should not be visible
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    expect(screen.queryByText("David Black")).not.toBeInTheDocument();
  });

  it('Payment status filter — paid: Assert only paid bidders are visible', async () => {
    render(<Bidders />);
    
    const selects = screen.getAllByTestId("mock-select");
    const paymentSelect = selects[1];

    // Select "Paid" payment ('paid')
    await user.selectOptions(paymentSelect, "paid");

    // John Doe and Charlie Brown should be visible (both have Paid attendee records)
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Charlie Brown")).toBeInTheDocument();

    // Jane, Alice, Bob, and David should not be visible
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob White")).not.toBeInTheDocument();
    expect(screen.queryByText("David Black")).not.toBeInTheDocument();
  });

  it('Payment status filter — unpaid/pending: Assert correct bidders visible', async () => {
    render(<Bidders />);
    
    const selects = screen.getAllByTestId("mock-select");
    const paymentSelect = selects[1];

    // Select "Pending" payment ('pending' matches registered with Pending status)
    await user.selectOptions(paymentSelect, "pending");

    // Jane Smith and David Black should be visible
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("David Black")).toBeInTheDocument();

    // John, Alice, Bob, and Charlie should not be visible
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob White")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
  });

  it('Source filter — walk-in: Assert only walk-in bidders are visible', async () => {
    render(<Bidders />);
    
    const selects = screen.getAllByTestId("mock-select");
    const sourceSelect = selects[2];

    // Select "General" source ('general' matches no attendee record i.e. walk-in bidders, as well as general tickets sheet)
    // Since our mock registered attendees are sponsor/staff tickets, walk-ins Alice Green & Bob White are the only ones filtered
    await user.selectOptions(sourceSelect, "general");

    // Alice Green and Bob White should be visible
    expect(screen.getByText("Alice Green")).toBeInTheDocument();
    expect(screen.getByText("Bob White")).toBeInTheDocument();

    // John, Jane, Charlie, and David should not be visible
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    expect(screen.queryByText("David Black")).not.toBeInTheDocument();
  });

  it('Clearing any filter restores all bidders: Assert all 6 are visible after clearing', async () => {
    render(<Bidders />);
    
    const selects = screen.getAllByTestId("mock-select");
    const statusSelect = selects[0];

    // Apply "Checked In" filter first
    await user.selectOptions(statusSelect, "checked-in");
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();

    // Clear filter by selecting "All Statuses" ('all')
    await user.selectOptions(statusSelect, "all");

    // All 6 bidders should now be visible again
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Alice Green")).toBeInTheDocument();
    expect(screen.getByText("Bob White")).toBeInTheDocument();
    expect(screen.getByText("Charlie Brown")).toBeInTheDocument();
    expect(screen.getByText("David Black")).toBeInTheDocument();
  });

  // Regression guard for the "UI / Layout Tweaks" redesign: the old
  // clickable-column-header sort UI (BiddersTable.tsx's SortableHead) was
  // removed when the table became a flexible row list (BiddersList.tsx),
  // and replaced with this "Sort by" select - this proves that control
  // still actually re-sorts the visible rows, not just displays a label.
  it('"Sort by" control re-sorts the visible bidder rows', async () => {
    const { container } = render(<Bidders />);

    const rowOrder = () =>
      Array.from(container.querySelectorAll('[data-testid^="bidder-row-"]')).map(
        (el) => el.getAttribute("data-testid")
      );

    // Default sort is id-asc: 101..108 in order.
    expect(rowOrder()[0]).toBe("bidder-row-101");
    expect(rowOrder()[rowOrder().length - 1]).toBe("bidder-row-108");

    const selects = screen.getAllByTestId("mock-select");
    const sortSelect = selects[3];
    await user.selectOptions(sortSelect, "id-desc");

    expect(rowOrder()[0]).toBe("bidder-row-108");
    expect(rowOrder()[rowOrder().length - 1]).toBe("bidder-row-101");
  });
});

describe('Bidders - Search', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it('Search finds matching bidder by name: Type a partial first name matching exactly one bidder → assert only that bidder is visible', async () => {
    render(<Bidders />);
    
    const searchInput = screen.getByPlaceholderText("Search bidders...");
    await user.type(searchInput, "John");

    // John Doe should be visible
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Other bidders should not be visible
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();
  });

  it('Search is case-insensitive: Type the same name in uppercase → assert the same bidder is found', async () => {
    render(<Bidders />);
    
    const searchInput = screen.getByPlaceholderText("Search bidders...");
    await user.type(searchInput, "JOHN");

    // John Doe should be visible
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Other bidders should not be visible
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
  });

  it('Search finds no results for unmatched query: Type a string matching no bidder → assert no rows visible', async () => {
    render(<Bidders />);
    
    const searchInput = screen.getByPlaceholderText("Search bidders...");
    await user.type(searchInput, "NonexistentBidderName");

    // No bidder names should be visible
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob White")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    expect(screen.queryByText("David Black")).not.toBeInTheDocument();
  });

  it('Dynamic search — results update on each keystroke: Type characters matching multiple bidders, then narrow to one → assert correct visibility at each step', async () => {
    render(<Bidders />);
    
    const searchInput = screen.getByPlaceholderText("Search bidders...");
    
    // Type 'J' (matches John, Jane)
    await user.type(searchInput, "J");
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.queryByText("Alice Green")).not.toBeInTheDocument();

    // Type 'a' to make it 'Ja' (matches Jane)
    await user.type(searchInput, "a");
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it('Clearing the search field restores all bidders: Type then user.clear(input) → assert all 6 bidders visible again', async () => {
    render(<Bidders />);
    
    const searchInput = screen.getByPlaceholderText("Search bidders...");
    await user.type(searchInput, "John");
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();

    await user.clear(searchInput);
    
    // All 8 should be back
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Alice Green")).toBeInTheDocument();
    expect(screen.getByText("Bob White")).toBeInTheDocument();
    expect(screen.getByText("Charlie Brown")).toBeInTheDocument();
    expect(screen.getByText("David Black")).toBeInTheDocument();
    expect(screen.getByText("Eve Taylor")).toBeInTheDocument();
    expect(screen.getByText("Frank Miller")).toBeInTheDocument();
  });
});

describe('Bidders - Empty state messaging', () => {
  // User-reported bug: the empty-state message always read
  // `No bidders found matching "${searchTerm}"` regardless of context -
  // with no search term, that rendered the confusing, unpolished
  // `No bidders found matching ""`. Fixed to match Items.tsx's own
  // distinction (src/components/Items.tsx's emptyMessage): "nothing has
  // ever loaded" gets a real, actionable message, "filtered down to
  // nothing" gets a different one, and neither ever shows a bare `""`.
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  afterEach(() => {
    authOverride = null;
  });

  it('shows a real, actionable message - not a bare "" - when no bidders have loaded at all', () => {
    authOverride = {
      bidders: [],
      attendees: [],
      loading: false,
      checkInBidder: mockCheckInBidder,
      markBidderAsProxy: mockMarkBidderAsProxy,
      fetchBidders: mockFetchBidders,
      fetchAttendees: mockFetchAttendees,
      isAuctionClosed: false,
    };
    render(<Bidders />);

    expect(screen.getByText(/No bidders loaded yet/)).toBeInTheDocument();
    expect(screen.getByText(/Set Up Bid Management App/)).toBeInTheDocument();
    expect(screen.queryByText(/matching ""/)).not.toBeInTheDocument();
  });

  it('shows a filtered-specific message - not the "nothing loaded" one - when bidders exist but the search matches none of them', async () => {
    render(<Bidders />);

    const searchInput = screen.getByPlaceholderText("Search bidders...");
    await user.type(searchInput, "NonexistentBidderName");

    expect(screen.getByText("No bidders match your search or filters.")).toBeInTheDocument();
    expect(screen.queryByText(/No bidders loaded yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/matching "NonexistentBidderName"/)).not.toBeInTheDocument();
  });
});

describe('Bidders - Event Ticket Status', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it('Paid ticket shows paid indicator: A bidder whose matching attendee has paymentStatus: "Paid" shows the paid status indicator', () => {
    render(<Bidders />);
    
    // John Doe's attendee record has paymentStatus: "Paid"
    const row = screen.getByTestId("bidder-row-101");
    expect(row).toBeInTheDocument();
    
    // Check that it contains "Ticket Paid"
    const paidBadge = row ? row.textContent : "";
    expect(paidBadge).toContain("Ticket Paid");
    expect(paidBadge).not.toContain("Ticket Pending");
  });

  it('Pending ticket shows pending indicator: A bidder whose matching attendee has paymentStatus: "Pending" shows the pending status indicator', () => {
    render(<Bidders />);
    
    // Jane Smith's attendee record has paymentStatus: "Pending"
    const row = screen.getByTestId("bidder-row-102");
    expect(row).toBeInTheDocument();
    
    // Check that it contains "Ticket Pending"
    const pendingBadge = row ? row.textContent : "";
    expect(pendingBadge).toContain("Ticket Pending");
    expect(pendingBadge).not.toContain("Ticket Paid");
  });

  it('No matching attendee shows appropriate state: A bidder with no matching attendee record renders without crashing and shows a neutral or default status', () => {
    render(<Bidders />);
    
    // Alice Green has no matching attendee record
    const row = screen.getByTestId("bidder-row-103");
    expect(row).toBeInTheDocument();
    
    // It should defaults to "Ticket Pending"
    const fallbackBadge = row ? row.textContent : "";
    expect(fallbackBadge).toContain("Ticket Pending");
    expect(fallbackBadge).not.toContain("Ticket Paid");
  });
});

describe('Bidders - Auction Status Indicators', () => {
  it('Not checked in: shows "Pending"', () => {
    render(<Bidders />);
    // Find a bidder that is not checked in, not checked out
    const row = screen.getByTestId("bidder-row-103");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Pending");
  });

  it('Checked in: shows "Checked-In"', () => {
    render(<Bidders />);
    // Find a bidder that is checked in
    const row = screen.getByTestId("bidder-row-101");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Checked-In");
  });

  it('Checked out: shows "Full Checkout"', () => {
    render(<Bidders />);
    const row = screen.getByTestId("bidder-row-107");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Full Checkout");
  });

  it('Checked out and paid: shows "Full Checkout"', () => {
    render(<Bidders />);
    const row = screen.getByTestId("bidder-row-108");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Full Checkout");
  });
});

describe('Bidders - Check-In Proxy Mutual Exclusion', () => {
  it('Checked-in bidder cannot be set as proxy: Assert proxy option is not present', () => {
    render(<Bidders />);
    // John Doe (checkedIn: true)
    const row = screen.getByTestId("bidder-row-101");
    expect(within(row).queryByRole("button", { name: /proxy/i })).not.toBeInTheDocument();
  });

  it('Proxy bidder cannot be checked in: Assert check-in option is not present', () => {
    render(<Bidders />);
    // Charlie Brown (isProxy: true)
    const row = screen.getByTestId("bidder-row-105");
    expect(within(row).queryByRole("button", { name: /check in/i })).not.toBeInTheDocument();
  });

  it('Neither checked-in nor proxy — both options available: Assert both options are available/enabled', () => {
    render(<Bidders />);
    // Alice Green (checkedIn: false, isProxy: false)
    const row = screen.getByTestId("bidder-row-103");
    expect(within(row).getByRole("button", { name: /check in/i })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /proxy/i })).toBeInTheDocument();
  });
});

// A not-checked-in, non-proxy bidder with a real, PENDING attendee record -
// the one combination handleCheckInAttempt (useBiddersState.ts) routes
// through the PendingPaymentDialog instead of checking in immediately.
// None of the shared mockBidders/mockAttendees above hit this combination
// (the only pending-attendee bidder, Jane Smith, is already checked in),
// so these tests override the AuctionContext mock with their own small
// dataset via authOverride instead of extending the shared arrays.
const pendingBidder = {
  id: "109",
  firstName: "Grace",
  lastName: "Pending",
  email: "grace@example.com",
  checkedIn: false,
  isProxy: false,
  checkedOut: false,
  paid: false,
};

const pendingAttendee = {
  id: "att-9",
  firstName: "Grace",
  lastName: "Pending",
  email: "grace@example.com",
  phone: "",
  sheet: "tickets",
  paymentStatus: "Pending",
  guestsInfo: [],
};

function usePendingBidderScenario(overrides: { ticketPrice?: string } = {}) {
  authOverride = {
    bidders: [pendingBidder],
    attendees: [pendingAttendee],
    loading: false,
    checkInBidder: mockCheckInBidder,
    markBidderAsProxy: mockMarkBidderAsProxy,
    fetchBidders: mockFetchBidders,
    fetchAttendees: mockFetchAttendees,
    isAuctionClosed: false,
  };
  configOverride = {
    config: {
      bidManagementSpreadsheetId: "test-bid-mgmt-id",
      auctionTicketsSpreadsheetId: "test-tickets-id",
      ticketPrice: overrides.ticketPrice ?? "35",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
    },
  };
}

describe('Bidders - Check-In', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it('checks in immediately (no dialog) when the bidder has no pending-payment attendee', async () => {
    // Alice Green (shared dataset): not checked in, not proxy, no
    // matching attendee record at all.
    render(<Bidders />);

    const row = screen.getByTestId("bidder-row-103");
    await user.click(within(row).getByRole("button", { name: /check in/i }));

    expect(mockCheckInBidder).toHaveBeenCalledTimes(1);
    expect(mockCheckInBidder).toHaveBeenCalledWith(expect.objectContaining({ id: "103", firstName: "Alice" }));
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it('opens the pending-payment confirmation instead of checking in immediately when the attendee has not paid', async () => {
    usePendingBidderScenario();
    render(<Bidders />);

    // Before the click, no dialog text naming Grace should be present.
    expect(screen.queryByText(/Grace Pending has not paid/i)).not.toBeInTheDocument();

    const row = screen.getByTestId("bidder-row-109");
    await user.click(within(row).getByRole("button", { name: /check in/i }));

    // The confirmation dialog's real description text now renders with
    // Grace's real name - proving handleCheckInAttempt routed through
    // setPendingCheckIn rather than checking in directly.
    expect(screen.getByText(/Grace Pending has not paid/i)).toBeInTheDocument();
    expect(mockCheckInBidder).not.toHaveBeenCalled();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it('"No, Do Not Add" checks the bidder in directly, without adding a ticket to their receipt', async () => {
    usePendingBidderScenario();
    render(<Bidders />);

    const row = screen.getByTestId("bidder-row-109");
    await user.click(within(row).getByRole("button", { name: /check in/i }));
    await user.click(screen.getByRole("button", { name: /no, do not add/i }));

    expect(mockCheckInBidder).toHaveBeenCalledTimes(1);
    expect(mockCheckInBidder).toHaveBeenCalledWith(expect.objectContaining({ id: "109" }));
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it('"Yes, Add to Receipt" POSTs the real /api/auction/check-in-with-bid payload', async () => {
    usePendingBidderScenario();
    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, bidAdded: true, checkedIn: true }),
    } as Response);

    render(<Bidders />);

    const row = screen.getByTestId("bidder-row-109");
    await user.click(within(row).getByRole("button", { name: /check in/i }));
    await user.click(screen.getByRole("button", { name: /yes, add to receipt/i }));

    expect(fetchWithRetry).toHaveBeenCalledWith(
      "http://localhost:3000/api/auction/check-in-with-bid",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    const body = JSON.parse((mockedFetchWithRetry.mock.calls[0][1] as any).body);
    expect(body).toMatchObject({
      bidderId: "109",
      spreadsheetId: "test-bid-mgmt-id",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
      bidValue: 35,
    });
    expect(typeof body.idempotencyKey).toBe("string");

    await new Promise((r) => setTimeout(r, 0));
    expect(toast.success).toHaveBeenCalledWith("Check-in complete and ticket added to Grace's receipt");
    expect(mockFetchBidders).toHaveBeenCalled();
  });

  it("falls back to a $35 bid value when the configured ticket price doesn't parse", async () => {
    usePendingBidderScenario({ ticketPrice: "not-a-number" });
    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, bidAdded: true, checkedIn: true }),
    } as Response);

    render(<Bidders />);

    const row = screen.getByTestId("bidder-row-109");
    await user.click(within(row).getByRole("button", { name: /check in/i }));
    await user.click(screen.getByRole("button", { name: /yes, add to receipt/i }));

    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse((mockedFetchWithRetry.mock.calls[0][1] as any).body);
    expect(body.bidValue).toBe(35);
  });

  it('shows an error toast (not a crash) and still refreshes the bidder list when the transactional check-in fails', async () => {
    usePendingBidderScenario();
    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Bidder column not found in Bid Management" }),
    } as Response);

    render(<Bidders />);

    const row = screen.getByTestId("bidder-row-109");
    await user.click(within(row).getByRole("button", { name: /check in/i }));
    await user.click(screen.getByRole("button", { name: /yes, add to receipt/i }));

    await new Promise((r) => setTimeout(r, 0));
    expect(toast.error).toHaveBeenCalledWith("Failed to sync updates. Your local change has been reverted.");
    expect(mockFetchBidders).toHaveBeenCalled();
  });
});

