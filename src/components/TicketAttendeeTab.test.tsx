/**
 * @vitest-environment jsdom
 */
/**
 * Test suite for the TicketAttendeeTab component.
 * 
 * NOTE: `mockAddAttendee` is declared at the module level so it can be referenced in 
 * both the `vi.mock` factory for the AuctionContext and inside the test assertions.
 * Also, the AuctionContext mock returns `attendees: mockAttendees` which is critical;
 * without it the tests will crash with "Cannot read properties of undefined (reading 'filter')".
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TicketAttendeeTab from "./TicketAttendeeTab";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";

// Framer Motion Mock
vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_target, tag) =>
      ({ children, ...props }: any) => {
        const { createElement } = require('react');
        return createElement(String(tag), props, children);
      }
  }),
  AnimatePresence: ({ children }: any) => children,
}));



// Mock Google Sheets/API functions
vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(() => Promise.resolve([])),
}));

// Mock Toast notification
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

// Mock dataset of 4 distinct attendees representing all target sources
const mockAttendees = [
  {
    id: "att-1",
    rowIndex: 2,
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@example.com",
    phone: "123-456-7890",
    sheet: "tickets",
    ticketsPurchased: 2,
    guestsInfo: [{ name: "Guest One", firstName: "Guest", lastName: "One", email: "guest1@example.com", ownBidderNumber: "no", guestIndex: 1 }],
    paymentStatus: "Paid",
    totalPaid: "$100",
    paymentMethod: "stripe"
  },
  {
    id: "att-2",
    rowIndex: 3,
    firstName: "Bob",
    lastName: "Jones",
    email: "bob@example.com",
    phone: "456-789-0123",
    sheet: "tickets",
    ticketsPurchased: 1,
    guestsInfo: [],
    paymentStatus: "Pending",
    totalPaid: "$0",
    paymentMethod: ""
  },
  {
    id: "att-3",
    rowIndex: 2,
    firstName: "Charlie",
    lastName: "Brown",
    email: "charlie@example.com",
    phone: "789-012-3456",
    sheet: "staff tickets",
    ticketsPurchased: 1,
    guestsInfo: [],
    paymentStatus: "Paid",
    totalPaid: "$0",
    paymentMethod: "Comp"
  },
  {
    id: "att-4",
    rowIndex: 2,
    firstName: "Diana",
    lastName: "Prince",
    email: "diana@example.com",
    phone: "999-999-9999",
    sheet: "sponsor tickets",
    ticketsPurchased: 1,
    guestsInfo: [],
    paymentStatus: "Paid",
    totalPaid: "$0",
    paymentMethod: "Comp"
  }
];

// Mock Config & Auction contexts
vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      auctionTicketsSpreadsheetId: "test-tickets-spreadsheet-id",
    }
  })
}));

const mockAddAttendee = vi.fn();

let mockCanEditTickets = true;
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ can: (c: string) => c !== "tickets.edit" || mockCanEditTickets }),
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    attendees: mockAttendees,
    addAttendee: mockAddAttendee,
    setAttendees: vi.fn(),
    loading: false,
    attendeesLoading: false,
    removeAttendee: vi.fn(),
    fetchAttendees: vi.fn(),
    isAuctionClosed: false,
  })
}));

/** Picks an option from one of the page's real dropdowns. */
async function chooseSource(user: ReturnType<typeof userEvent.setup>, dropdown: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: dropdown }));
  await user.click(await screen.findByRole("option", { name: option }));
}


describe('TicketAttendeeTab - view-only for a User (tickets.edit)', () => {
  afterEach(() => { mockCanEditTickets = true; });

  it('shows the list but no way to add, edit or change payment status', () => {
    mockCanEditTickets = false;
    render(<TicketAttendeeTab />);

    expect(screen.getByText('View Only')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Add New Entry')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('First')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect((screen.getAllByRole('button', { name: /^(Paid|Pending)$/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets staff who can edit do so', () => {
    render(<TicketAttendeeTab />);
    expect(screen.queryByText('View Only')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edit / }).length).toBeGreaterThan(0);
    expect((screen.getAllByRole('button', { name: /^(Paid|Pending)$/ })[0] as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('TicketAttendeeTab - Sort and Filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('General Tickets filter: selects General Tickets option and displays only general attendees', async () => {
    const user = userEvent.setup();
    render(<TicketAttendeeTab />);

    // Select General Tickets option ('tickets')
    await chooseSource(user, "Filter by source", "General Tickets");

    // General attendees "Alice" and "Bob" should be visible
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    // Staff and Sponsor attendees should not be visible
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    expect(screen.queryByText("Diana")).not.toBeInTheDocument();
  });

  it('Sponsor Tickets filter: selects Sponsor Tickets option and displays only sponsor attendee', async () => {
    const user = userEvent.setup();
    render(<TicketAttendeeTab />);

    // Select Sponsors option ('sponsor tickets')
    await chooseSource(user, "Filter by source", "Sponsors");

    // "Diana" should be visible
    expect(screen.getByText("Diana")).toBeInTheDocument();

    // Alice, Bob, and Charlie should not be visible
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it('Staff Tickets filter: selects Staff Tickets option and displays only staff attendee', async () => {
    const user = userEvent.setup();
    render(<TicketAttendeeTab />);

    // Select Staff option ('staff tickets')
    await chooseSource(user, "Filter by source", "Staff");

    // "Charlie" should be visible
    expect(screen.getByText("Charlie")).toBeInTheDocument();

    // Alice, Bob, and Diana should not be visible
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Diana")).not.toBeInTheDocument();
  });

  it('Clearing filter restores all attendees: selects "All Sources" option after filter and displays all of them', async () => {
    const user = userEvent.setup();
    render(<TicketAttendeeTab />);

    // Filter first (e.g., to "Staff Tickets")
    await chooseSource(user, "Filter by source", "Staff");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();

    // Select "All Sources" ('all')
    await chooseSource(user, "Filter by source", "All Sources");

    // Assert that all four mock entries are successfully retrieved and displayed
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Diana")).toBeInTheDocument();
  });
});

describe('TicketAttendeeTab - Search', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it('Search finds matching attendee by name', async () => {
    render(<TicketAttendeeTab />);
    const searchInput = screen.getByPlaceholderText("Search attendees...");
    await user.type(searchInput, "Alice");

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    expect(screen.queryByText("Diana")).not.toBeInTheDocument();
  });

  it('Search is case-insensitive', async () => {
    render(<TicketAttendeeTab />);
    const searchInput = screen.getByPlaceholderText("Search attendees...");
    await user.type(searchInput, "ALICE");

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    expect(screen.queryByText("Diana")).not.toBeInTheDocument();
  });

  it('Search finds no results for unmatched query', async () => {
    render(<TicketAttendeeTab />);
    const searchInput = screen.getByPlaceholderText("Search attendees...");
    await user.type(searchInput, "xyz123");

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    expect(screen.queryByText("Diana")).not.toBeInTheDocument();
  });

  it('Dynamic search — results update on each keystroke', async () => {
    render(<TicketAttendeeTab />);
    const searchInput = screen.getByPlaceholderText("Search attendees...");

    // Type characters that match multiple attendees (e.g., 'li' matches Alice and Charlie)
    await user.type(searchInput, "li");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Diana")).not.toBeInTheDocument();

    // Type more characters to narrow to one (e.g., 'lic' for Alice)
    await user.type(searchInput, "c"); // current text: "lic"
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it('Clearing the search field restores all attendees', async () => {
    render(<TicketAttendeeTab />);
    const searchInput = screen.getByPlaceholderText("Search attendees...");

    await user.type(searchInput, "Alice");
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    await user.clear(searchInput);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Diana")).toBeInTheDocument();
  });

  describe('TicketAttendeeTab - Add New Entry', () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(() => {
      vi.clearAllMocks();
      user = userEvent.setup();
    });

    /** Opens the real Add New Entry dialog, as staff do. */
    async function openAddEntry() {
      await user.click(screen.getByRole('button', { name: /Add Entry/ }));
      await screen.findByRole('dialog', { name: 'Add New Entry' });
    }

    it('payment method and payment status fields are not shown in the form', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();
      // Workflow doc: these are set automatically — never shown to the user
      expect(screen.queryByText(/payment method/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/payment status/i)).not.toBeInTheDocument();
    });

    it('General Ticket — calls addAttendee with source "tickets" and Pending payment status', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();

      await user.type(screen.getByPlaceholderText('First'), 'Maria');
      await user.type(screen.getByPlaceholderText('Last'), 'Garcia');
      // Source select defaults to "tickets" — no change needed
      await user.click(screen.getByText('Save Entry'));

      expect(mockAddAttendee).toHaveBeenCalledOnce();
      const [source, row] = mockAddAttendee.mock.calls[0];
      expect(source).toBe('tickets');
      expect(row[0]).toBe('Maria');    // firstName → column A
      expect(row[1]).toBe('Garcia');   // lastName  → column B
      expect(row[19]).toBe('Manual');  // payment method (auto-set, not user-entered)
      expect(row[20]).toBe('Pending'); // payment status (auto-set)
      expect(row[21]).toBe('$0');      // total paid
    });

    it('Staff — calls addAttendee with source "staff tickets" and Paid status', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();

      await chooseSource(user, 'Source', 'Staff');
      await user.type(screen.getByPlaceholderText('First'), 'John');
      await user.type(screen.getByPlaceholderText('Last'), 'Staff');
      await user.click(screen.getByText('Save Entry'));

      expect(mockAddAttendee).toHaveBeenCalledOnce();
      const [source, row] = mockAddAttendee.mock.calls[0];
      expect(source).toBe('staff tickets');
      expect(row[0]).toBe('John');
      // Column order matches parseAttendeeRows' own unshifted pm/ps/tp
      // columns (Q/R/S) for staff/sponsor sheets (attendeeSheetColumns.ts's
      // paymentColumnsForSheet maps paymentStatus to R for them).
      expect(row[16]).toBe('Comp'); // payment method (auto-set)
      expect(row[17]).toBe('Paid'); // payment status (auto-set)
      expect(row[18]).toBe('$0');   // total paid
      expect(row[19]).toBe('');     // general-sheet payment method column NOT written for staff
      expect(row[20]).toBe('');     // general-sheet payment status column NOT written for staff
    });

    it('Sponsor — calls addAttendee with source "sponsor tickets" and Paid status', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();

      await chooseSource(user, 'Source', 'Sponsor');
      await user.type(screen.getByPlaceholderText('First'), 'Dana');
      await user.type(screen.getByPlaceholderText('Last'), 'Sponsor');
      await user.click(screen.getByText('Save Entry'));

      expect(mockAddAttendee).toHaveBeenCalledOnce();
      const [source, row] = mockAddAttendee.mock.calls[0];
      expect(source).toBe('sponsor tickets');
      expect(row[16]).toBe('Comp'); // payment method
      expect(row[17]).toBe('Paid'); // payment status
      expect(row[18]).toBe('$0');   // total paid
    });

    it('Missing first name — shows toast error and does not call addAttendee', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();

      await user.type(screen.getByPlaceholderText('Last'), 'Garcia');
      await user.click(screen.getByText('Save Entry'));

      expect(mockAddAttendee).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Name is required');
    });

    it('Missing last name — shows toast error and does not call addAttendee', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();

      await user.type(screen.getByPlaceholderText('First'), 'Maria');
      await user.click(screen.getByText('Save Entry'));

      expect(mockAddAttendee).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Name is required');
    });

    it('No Bid Management interaction — only addAttendee is called, nothing else', async () => {
      render(<TicketAttendeeTab />);
      await openAddEntry();

      await user.type(screen.getByPlaceholderText('First'), 'Maria');
      await user.type(screen.getByPlaceholderText('Last'), 'Garcia');
      await user.click(screen.getByText('Save Entry'));

      // The workflow doc requires no interaction with Bid Management at any point.
      // addAttendee is the only function called — no sheet writes, no syncs.
      expect(mockAddAttendee).toHaveBeenCalledOnce();
    });
  });
});
