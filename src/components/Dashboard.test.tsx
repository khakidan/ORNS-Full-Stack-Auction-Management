/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, act, within } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { vi, describe, it, expect, beforeEach } from "vitest";

// Framer Motion mock as requested
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

// Recharts mock for JSDOM
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  PieChart: ({ children }: any) => <svg data-testid="pie-chart">{children}</svg>,
  Pie: ({ data }: any) => (
    <g data-testid="pie">
      {data?.map((entry: any, i: number) => (
        <text key={i} data-testid={`pie-slice-${entry.name}`}>
          {entry.name}: {entry.value}
        </text>
      ))}
    </g>
  ),
  Cell: () => <g data-testid="cell" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

// Sonner mock
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// Google API mock to prevent network requests
vi.mock("@/lib/google-api", () => ({
  getSheetData: vi.fn(() => Promise.resolve({ values: [] })),
  updateSheetData: vi.fn(() => Promise.resolve({})),
  appendSheetData: vi.fn(() => Promise.resolve({})),
}));

// Mock UI ScrollArea safely
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// Configure deterministic mock data
const mockBidders = [
  // 3 checked-in & pending checkout (Alice and Bob are paid, Charlie is unpaid)
  { id: "1", firstName: "Alice", lastName: "Smith", email: "alice@email.com", checkedIn: true, checkedOut: false, paid: true, isProxy: false },
  { id: "2", firstName: "Bob", lastName: "Jones", email: "bob@email.com", checkedIn: true, checkedOut: false, paid: true, isProxy: false },
  { id: "3", firstName: "Charlie", lastName: "Brown", email: "charlie@email.com", checkedIn: true, checkedOut: false, paid: false, isProxy: false },
  // 3 checked-in & checked-out
  { id: "4", firstName: "Diana", lastName: "Prince", email: "diana@email.com", checkedIn: true, checkedOut: true, paid: true, isProxy: false },
  { id: "5", firstName: "Ethan", lastName: "Hunt", email: "ethan@email.com", checkedIn: true, checkedOut: true, paid: true, isProxy: false },
  { id: "6", firstName: "Fiona", lastName: "Gallagher", email: "fiona@email.com", checkedIn: true, checkedOut: true, paid: true, isProxy: false },
  // 3 no shows (never checked-in, never checked-out, not proxy)
  { id: "7", firstName: "George", lastName: "Weasley", email: "george@email.com", checkedIn: false, checkedOut: false, paid: false, isProxy: false },
  { id: "8", firstName: "Hannah", lastName: "Abbott", email: "hannah@email.com", checkedIn: false, checkedOut: false, paid: false, isProxy: false },
  { id: "9", firstName: "Ian", lastName: "Malcolm", email: "ian@email.com", checkedIn: false, checkedOut: false, paid: false, isProxy: false },
  // 1 proxy bidder (always Jack)
  { id: "10", firstName: "Jack", lastName: "Reacher", email: "jack@email.com", checkedIn: false, checkedOut: false, paid: false, isProxy: true },
];

const mockAttendees = Array.from({ length: 8 }, (_, i) => ({
  id: `att-${i + 1}`,
  firstName: `AttendeeFirst-${i + 1}`,
  lastName: `AttendeeLast-${i + 1}`,
  email: `att-${i + 1}@example.com`,
  sheet: "tickets",
  rowIndex: i + 2,
  paymentStatus: "Paid",
}));

const mockItems = Array.from({ length: 15 }, (_, i) => ({
  id: `item-${101 + i}`,
  name: `Item ${i + 1}`,
  description: `Description ${i + 1}`,
  category: "Food",
  value: "$100",
  donor: `Donor ${i + 1}`,
  itemType: "Certificate",
  status: "Active",
}));

const mockContextValue = {
  bidders: mockBidders,
  attendees: mockAttendees,
  items: mockItems,
  totalRaised: 1500,
  loading: false,
  isAuctionClosed: true,
  winners: {},
};

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => mockContextValue,
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      bidManagementSpreadsheetId: "test-spreadsheet-id",
    },
  }),
}));

describe("Dashboard - Widget Display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Bidders Present: Assert the widget shows the count of checked-in bidders (6)", async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    // Checked in count is 6, total is 10. The text should display "6 / 10"
    const biddersCard = screen.getByText("Bidders Present").closest('[data-slot="card"]');
    expect(biddersCard).toBeInTheDocument();
    expect(screen.getByText("6 / 10")).toBeInTheDocument();
  });

  it("Checkout Status: Assert the widget shows the correct paid/unpaid breakdown for checked-out bidders", async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    
    // Checked out count is 3. Pending count is 3. Present is 6.
    const checkoutCard = screen.getByText("Checkout Status").closest('[data-slot="card"]') as HTMLElement;
    expect(checkoutCard).toBeInTheDocument();
    expect(checkoutCard).toHaveTextContent("3 Checked Out");
    expect(screen.getByText("3 Pending")).toBeInTheDocument();
    expect(screen.getByText("of 6 Present")).toBeInTheDocument();

    // Since isAuctionClosed is true, "Still Need to Check Out" section lists pending checkout bidders:
    // Alice (Paid), Bob (Paid), Charlie (Unpaid)
    expect(screen.getByText("Still Need to Check Out")).toBeInTheDocument();
    expect(screen.getByText("#1 Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("#2 Bob Jones")).toBeInTheDocument();
    expect(screen.getByText("#3 Charlie Brown")).toBeInTheDocument();

    // Alice has a paid badge, Bob has a paid badge, Charlie has an unpaid badge
    const aliceRow = screen.getByText("#1 Alice Smith").closest(".border-b");
    const bobRow = screen.getByText("#2 Bob Jones").closest(".border-b");
    const charlieRow = screen.getByText("#3 Charlie Brown").closest(".border-b");

    expect(aliceRow).toHaveTextContent("Paid");
    expect(bobRow).toHaveTextContent("Paid");
    expect(charlieRow).toHaveTextContent("Unpaid");
  });

  it("Auction Items: Assert the widget shows the correct item count", async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    // Item count should show 15
    const itemsCard = screen.getByText("Auction Items").closest('[data-slot="card"]');
    expect(itemsCard).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("Total Raised: Assert the widget shows the correct summed amount based on mock bid data", async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    // Total raised is 1500, displayed formatted as $1,500.00
    const raisedCard = screen.getByText("Total Raised").closest('[data-slot="card"]');
    expect(raisedCard).toBeInTheDocument();
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
  });

  it("Attendance Overview: Assert the widget shows the correct attendee count (8)", async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    // Verify Attendance Overview card is rendered
    expect(screen.getByText("Attendance Overview")).toBeInTheDocument();

    // Verify actual statistical count elements of the Pie component mock
    expect(screen.getByTestId("pie-slice-Checked In")).toHaveTextContent("Checked In: 6");
    expect(screen.getByTestId("pie-slice-Checked Out")).toHaveTextContent("Checked Out: 3");
    expect(screen.getByTestId("pie-slice-Not Present")).toHaveTextContent("Not Present: 4");
  });

  it("Proxy Bidders: Assert the widget shows the proxy bidder count (1)", async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    // Proxy Bidders section title is "Proxy Bidders (1)"
    expect(screen.getByText("Proxy Bidders (1)")).toBeInTheDocument();
    // Jack Reacher should be listed as the proxy bidder
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(screen.getByText("Jack Reacher")).toBeInTheDocument();
  });
});
