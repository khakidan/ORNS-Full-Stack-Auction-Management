/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, act, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(() => Promise.resolve({ values: [] })),
  updateSheetData: vi.fn(() => Promise.resolve({})),
  appendSheetData: vi.fn(() => Promise.resolve({})),
}));

import { getSheetData, updateSheetData, appendSheetData } from "@/services/google-api";
const mockedGetSheetData = vi.mocked(getSheetData);
const mockedUpdateSheetData = vi.mocked(updateSheetData);
const mockedAppendSheetData = vi.mocked(appendSheetData);
import { toast } from "sonner";

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
    // 10 total - 6 checked in - 1 proxy (Jack, tracked separately in the
    // Proxy Bidders widget, not double-counted here as "absent") = 3.
    expect(screen.getByTestId("pie-slice-Not Present")).toHaveTextContent("Not Present: 3");
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

// Alice (id 1) is checked in but not checked out - a normal save.
// Diana (id 4) is already checked out - saving her as a special winner
// must also add a Follow-Up row, per useDashboardState.ts's
// saveGiftCardWinner/saveRaffleWinner.
function mockSpecialWinners(giftCardId: string, raffleId: string) {
  mockedGetSheetData.mockImplementation((_spreadsheetId: string, range: string) => {
    if (range.startsWith("Special-Winners")) {
      return Promise.resolve({ values: [["$500 Amazon Gift Card", giftCardId], ["50/50 Raffle", raffleId]] });
    }
    if (range.startsWith("Follow-Up")) {
      return Promise.resolve({ values: [] });
    }
    return Promise.resolve({ values: [] });
  });
}

describe("Dashboard - Special Winners & Follow-Up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSheetData.mockResolvedValue({ values: [] });
    mockedUpdateSheetData.mockResolvedValue({});
    mockedAppendSheetData.mockResolvedValue({});
  });

  it("loads existing Special-Winners on mount and resolves the winner's name", async () => {
    mockSpecialWinners("1", "2"); // Alice, Bob

    await act(async () => {
      render(<Dashboard />);
    });

    const gcField = screen.getByLabelText("$500 Amazon Gift Card").closest("div")!.parentElement!;
    await waitFor(() => {
      expect(within(gcField).getByText(/Winner:/)).toHaveTextContent("Winner: Alice Smith");
    });
    const raffleField = screen.getByLabelText("50/50 Raffle").closest("div")!.parentElement!;
    expect(within(raffleField).getByText(/Winner:/)).toHaveTextContent("Winner: Bob Jones");
  });

  it("saves a gift card winner who hasn't checked out: writes Special-Winners!B2 only, no Follow-Up row", async () => {
    mockSpecialWinners("1", ""); // Alice - checkedOut: false
    const user = userEvent.setup();

    await act(async () => {
      render(<Dashboard />);
    });
    await waitFor(() => expect(screen.getByLabelText("$500 Amazon Gift Card")).toHaveValue("1"));

    const gcField = screen.getByLabelText("$500 Amazon Gift Card").closest("div")!;
    await act(async () => {
      await user.click(within(gcField).getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(updateSheetData).toHaveBeenCalledWith("test-spreadsheet-id", "Special-Winners!B2", [["1"]]);
    });
    expect(appendSheetData).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Updated $500 Amazon Gift Card winner");
  });

  it("saves an already-checked-out gift card winner: also appends a Follow-Up row and warns, then refreshes the follow-up list", async () => {
    mockSpecialWinners("4", ""); // Diana - checkedOut: true
    const user = userEvent.setup();

    await act(async () => {
      render(<Dashboard />);
    });
    await waitFor(() => expect(screen.getByLabelText("$500 Amazon Gift Card")).toHaveValue("4"));

    const getSheetDataCallsBeforeSave = mockedGetSheetData.mock.calls.length;

    const gcField = screen.getByLabelText("$500 Amazon Gift Card").closest("div")!;
    await act(async () => {
      await user.click(within(gcField).getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(updateSheetData).toHaveBeenCalledWith("test-spreadsheet-id", "Special-Winners!B2", [["4"]]);
    });
    expect(appendSheetData).toHaveBeenCalledWith(
      "test-spreadsheet-id",
      "Follow-Up!A:C",
      [["4", "$500 Amazon Gift Card", ""]]
    );
    expect(toast.warning).toHaveBeenCalledWith(
      "Checked Out Warning",
      expect.objectContaining({
        description: expect.stringContaining("Diana Prince won \"$500 Amazon Gift Card\" but has already checked out.")
      })
    );
    // The follow-up list is refetched after the append, beyond the initial mount fetch.
    await waitFor(() => {
      expect(mockedGetSheetData.mock.calls.length).toBeGreaterThan(getSheetDataCallsBeforeSave);
    });
  });

  it("shows an error and writes nothing when the loaded winner ID doesn't match any bidder", async () => {
    mockSpecialWinners("999", ""); // no such bidder
    const user = userEvent.setup();

    await act(async () => {
      render(<Dashboard />);
    });
    await waitFor(() => expect(screen.getByLabelText("$500 Amazon Gift Card")).toHaveValue("999"));

    const gcField = screen.getByLabelText("$500 Amazon Gift Card").closest("div")!;
    await act(async () => {
      await user.click(within(gcField).getByRole("button", { name: "Save" }));
    });

    expect(toast.error).toHaveBeenCalledWith("Bidder ID not found");
    expect(updateSheetData).not.toHaveBeenCalled();
    expect(appendSheetData).not.toHaveBeenCalled();
  });

  it("shows an error toast (not a crash) when the Special-Winners write itself fails", async () => {
    mockSpecialWinners("1", "");
    mockedUpdateSheetData.mockRejectedValue(new Error("Sheets API quota exceeded"));
    const user = userEvent.setup();

    await act(async () => {
      render(<Dashboard />);
    });
    await waitFor(() => expect(screen.getByLabelText("$500 Amazon Gift Card")).toHaveValue("1"));

    const gcField = screen.getByLabelText("$500 Amazon Gift Card").closest("div")!;
    await act(async () => {
      await user.click(within(gcField).getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to save winner: Sheets API quota exceeded");
    });
  });

  it("saves the raffle winner independently of the gift card field", async () => {
    mockSpecialWinners("", "2"); // Bob, raffle only
    const user = userEvent.setup();

    await act(async () => {
      render(<Dashboard />);
    });
    await waitFor(() => expect(screen.getByLabelText("50/50 Raffle")).toHaveValue("2"));

    const raffleField = screen.getByLabelText("50/50 Raffle").closest("div")!;
    await act(async () => {
      await user.click(within(raffleField).getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(updateSheetData).toHaveBeenCalledWith("test-spreadsheet-id", "Special-Winners!B3", [["2"]]);
    });
    expect(toast.success).toHaveBeenCalledWith("Updated 50/50 Raffle winner");
  });

  it("Refresh Lists re-fetches Follow-Up records and renders them in the Post-Checkout Item Wins panel", async () => {
    let followUpCallCount = 0;
    mockedGetSheetData.mockImplementation((_spreadsheetId: string, range: string) => {
      if (range.startsWith("Follow-Up")) {
        followUpCallCount++;
        if (followUpCallCount === 1) {
          return Promise.resolve({ values: [] }); // initial mount: nothing yet
        }
        return Promise.resolve({
          values: [
            ["Header", "Header", "Header"],
            ["4", "item-101", "50"], // Diana (id 4) - already checked out, so she won't also appear in "Still Need to Check Out"
          ],
        });
      }
      return Promise.resolve({ values: [] });
    });
    const user = userEvent.setup();

    await act(async () => {
      render(<Dashboard />);
    });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Refresh Lists/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("#4 Diana Prince")).toBeInTheDocument();
    });
    expect(screen.getByText("Won Item: item-101")).toBeInTheDocument();
  });

  it("swallows a failed follow-up fetch without crashing (records stay empty)", async () => {
    mockedGetSheetData.mockImplementation((_spreadsheetId: string, range: string) => {
      if (range.startsWith("Follow-Up")) return Promise.reject(new Error("network down"));
      return Promise.resolve({ values: [] });
    });

    await act(async () => {
      render(<Dashboard />);
    });

    expect(screen.getByText("No items have been assigned to checked-out bidders yet.")).toBeInTheDocument();
  });
});
