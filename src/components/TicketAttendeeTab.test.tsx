/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TicketAttendeeTab from "./TicketAttendeeTab";
import { vi, describe, it, expect, beforeEach } from "vitest";

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

// Mock standard select component as a native HTML elect element for easy/reliable testing
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
  SelectTrigger: () => null,
  SelectValue: ({ placeholder }: any) => <option value="" disabled>{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

// Dialog component mock with support of custom 'render' trigger prop used in the code
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => <div data-testid="mock-dialog" data-open={open}>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children, render }: any) => <>{children || render}</>,
}));

// Mock Google Sheets/API functions
vi.mock("@/lib/google-api", () => ({
  updateSheetData: vi.fn(() => Promise.resolve({ success: true })),
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
    guestsInfo: [{ name: "Alice Guest 1", email: "guest1@example.com", ownBidderNumber: "no", guestIndex: 1 }],
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

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    attendees: mockAttendees,
    setAttendees: vi.fn(),
    loading: false,
    addAttendee: vi.fn(),
    removeAttendee: vi.fn(),
    fetchAttendees: vi.fn(),
    isAuctionClosed: false,
  })
}));

describe('TicketAttendeeTab - Sort and Filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('General Tickets filter: selects General Tickets option and displays only general attendees', async () => {
    const user = userEvent.setup();
    render(<TicketAttendeeTab />);

    // Get the first dropdown which is the filter select
    const filterSelect = screen.getAllByTestId("mock-select")[0];
    
    // Select General Tickets option ('tickets')
    await user.selectOptions(filterSelect, "tickets");

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

    const filterSelect = screen.getAllByTestId("mock-select")[0];
    
    // Select Sponsors option ('sponsor tickets')
    await user.selectOptions(filterSelect, "sponsor tickets");

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

    const filterSelect = screen.getAllByTestId("mock-select")[0];
    
    // Select Staff option ('staff tickets')
    await user.selectOptions(filterSelect, "staff tickets");

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

    const filterSelect = screen.getAllByTestId("mock-select")[0];
    
    // Filter first (e.g., to "Staff Tickets")
    await user.selectOptions(filterSelect, "staff tickets");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();

    // Select "All Sources" ('all')
    await user.selectOptions(filterSelect, "all");

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
});

