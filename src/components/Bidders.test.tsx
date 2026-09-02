/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Bidders from "./Bidders";
import { vi, describe, it, expect, beforeEach } from "vitest";

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
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children }: any) => <button>{children}</button>,
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
vi.mock("@/lib/google-api", () => ({
  fetchWithRetry: vi.fn(),
  updateSheetData: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  getSheetData: vi.fn(),
  appendSheetData: vi.fn(),
}));

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

// Mock Config & Auction contexts
vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      bidManagementSpreadsheetId: "test-bid-mgmt-id",
      auctionTicketsSpreadsheetId: "test-tickets-id",
      ticketPrice: "35",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
    }
  })
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    bidders: mockBidders,
    attendees: mockAttendees,
    loading: false,
    checkInBidder: vi.fn(),
    markBidderAsProxy: vi.fn(),
    fetchBidders: vi.fn(),
    fetchAttendees: vi.fn(),
    isAuctionClosed: false,
  })
}));

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

describe('Bidders - Event Ticket Status', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it('Paid ticket shows paid indicator: A bidder whose matching attendee has paymentStatus: "Paid" shows the paid status indicator', () => {
    render(<Bidders />);
    
    // John Doe's attendee record has paymentStatus: "Paid"
    const row = screen.getByText("John Doe").closest("tr");
    expect(row).toBeInTheDocument();
    
    // Check that it contains "Ticket Paid"
    const paidBadge = row ? row.textContent : "";
    expect(paidBadge).toContain("Ticket Paid");
    expect(paidBadge).not.toContain("Ticket Pending");
  });

  it('Pending ticket shows pending indicator: A bidder whose matching attendee has paymentStatus: "Pending" shows the pending status indicator', () => {
    render(<Bidders />);
    
    // Jane Smith's attendee record has paymentStatus: "Pending"
    const row = screen.getByText("Jane Smith").closest("tr");
    expect(row).toBeInTheDocument();
    
    // Check that it contains "Ticket Pending"
    const pendingBadge = row ? row.textContent : "";
    expect(pendingBadge).toContain("Ticket Pending");
    expect(pendingBadge).not.toContain("Ticket Paid");
  });

  it('No matching attendee shows appropriate state: A bidder with no matching attendee record renders without crashing and shows a neutral or default status', () => {
    render(<Bidders />);
    
    // Alice Green has no matching attendee record
    const row = screen.getByText("Alice Green").closest("tr");
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
    const row = screen.getByText("Alice Green").closest("tr");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Pending");
  });

  it('Checked in: shows "Checked-In"', () => {
    render(<Bidders />);
    // Find a bidder that is checked in
    const row = screen.getByText("John Doe").closest("tr");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Checked-In");
  });

  it('Checked out: shows "Full Checkout"', () => {
    render(<Bidders />);
    const row = screen.getByText("Eve Taylor").closest("tr");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Full Checkout");
  });

  it('Checked out and paid: shows "Full Checkout"', () => {
    render(<Bidders />);
    const row = screen.getByText("Frank Miller").closest("tr");
    expect(row).toBeInTheDocument();
    expect(row?.textContent).toContain("Full Checkout");
  });
});

describe('Bidders - Check-In Proxy Mutual Exclusion', () => {
  it('Checked-in bidder cannot be set as proxy: Assert proxy option is not present', () => {
    render(<Bidders />);
    // John Doe (checkedIn: true)
    const row = screen.getByText("John Doe").closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: /proxy/i })).not.toBeInTheDocument();
  });

  it('Proxy bidder cannot be checked in: Assert check-in option is not present', () => {
    render(<Bidders />);
    // Charlie Brown (isProxy: true)
    const row = screen.getByText("Charlie Brown").closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: /check in/i })).not.toBeInTheDocument();
  });

  it('Neither checked-in nor proxy — both options available: Assert both options are available/enabled', () => {
    render(<Bidders />);
    // Alice Green (checkedIn: false, isProxy: false)
    const row = screen.getByText("Alice Green").closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: /check in/i })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /proxy/i })).toBeInTheDocument();
  });
});

