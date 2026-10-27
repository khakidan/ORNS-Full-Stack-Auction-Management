// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchivedYearPanel from "./ArchivedYearPanel";
import { getSheetData } from "@/services/google-api";
import { ArchivedAuction } from "@/types";

vi.mock("@/services/google-api", () => ({ getSheetData: vi.fn() }));
vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: { bidderNumbersSheet: "Bidder-Numbers", bidManagementSheet: "Bid-Management" } }),
}));
// recharts needs a real layout engine.
vi.mock("@/components/AttendanceChart", () => ({
  AttendanceChart: ({ bidderStats }: any) => <div>chart:{bidderStats.map((s: any) => `${s.name}=${s.value}`).join(",")}</div>,
}));

const full: ArchivedAuction = {
  year: 2026, folderId: "f", folderLink: "https://drive/f", bidManagementSpreadsheetId: "bm", itemsSpreadsheetId: "it",
};

// A,B,C,D,E(checked in),F(proxy)
const bidderRows = [
  ["ID", "First", "Last", "Email", "Checked In", "Proxy"],
  ["1", "Ann", "Lee", "ann@x.org", "TRUE", "FALSE"],
  ["2", "Bob", "Ray", "bob@x.org", "FALSE", "FALSE"],
  ["3", "Cy", "Poe", "cy@x.org", "FALSE", "TRUE"],
  ["4", "Di", "Fox", "di@x.org", "FALSE", "FALSE"],
];
const itemRows = [
  ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donor", "Item Type", "Status"],
  ["101", "Art", "Sunset Painting", "", "", "", "", "", "", "Active"],
  ["102", "Art", "Retired Thing", "", "", "", "", "", "", "Inactive"],
  ["103", "Art", "Lonely Vase", "", "", "", "", "", "", "Active"],
  ["1501", "Raffle Tickets", "One Raffle Ticket", "", "", "", "", "", "", "Active", "", "", true],
];
// bidder 1 won item 101 for $50
const grid = [["1", ""], ["", ""], ["", ""], ["101", "$50"]];

function mockSheets() {
  vi.mocked(getSheetData).mockImplementation(async (_id: string, range: string) => {
    if (range.startsWith("Bidder-Numbers")) return { values: bidderRows };
    if (range.startsWith("Bid-Management")) return { values: grid };
    return { values: itemRows };
  });
}

describe("ArchivedYearPanel", () => {
  beforeEach(() => { vi.mocked(getSheetData).mockReset(); });

  it("says there isn't enough information when the year has no folder, without reading any sheet", () => {
    render(<ArchivedYearPanel auction={{ ...full, folderId: null, folderLink: null, bidManagementSpreadsheetId: null }} />);

    expect(screen.getByText("Not enough information for the 2026 auction")).toBeInTheDocument();
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it("says so when the folder exists but its Bid Management copy doesn't", () => {
    render(<ArchivedYearPanel auction={{ ...full, bidManagementSpreadsheetId: null }} />);

    expect(screen.getByText(/has no "2026 Bid Management" spreadsheet/)).toBeInTheDocument();
  });

  it("says so when the Bid Management copy has no bidder records", async () => {
    vi.mocked(getSheetData).mockResolvedValue({ values: [] });
    render(<ArchivedYearPanel auction={full} />);

    expect(await screen.findByText(/has no bidder records/)).toBeInTheDocument();
  });

  it("shows attendance on the Overview, counting a bidder who never checked in as a no-show but not the proxy bidder", async () => {
    mockSheets();
    render(<ArchivedYearPanel auction={full} />);

    expect(await screen.findByText("chart:Checked In=1,No-Show=2,Proxy=1")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("67% of bidders expected in person")).toBeInTheDocument();
    // 101 (won) and 103 (no bid) are the auction items; 1501 is multi-winner, 102 inactive.
    expect(screen.getByText("of 2 auction items")).toBeInTheDocument();
  });

  it("switches sections from the rail: No-Shows lists only the no-shows, Catalog shows active items with their winner", async () => {
    mockSheets();
    render(<ArchivedYearPanel auction={full} />);
    await screen.findByText(/chart:/);
    const rail = screen.getByRole("navigation", { name: "2026 auction sections" });

    await userEvent.click(within(rail).getByRole("button", { name: /No-Shows/ }));
    expect(screen.getByTestId("archived-bidder-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("archived-bidder-row-4")).toBeInTheDocument();
    expect(screen.queryByTestId("archived-bidder-row-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("archived-bidder-row-3")).not.toBeInTheDocument();

    await userEvent.click(within(rail).getByRole("button", { name: /Auction Catalog/ }));
    await waitFor(() => expect(screen.getByTestId("item-row-101")).toHaveTextContent("Ann Lee"));
    expect(screen.queryByTestId("item-row-102")).not.toBeInTheDocument();

    await userEvent.click(within(rail).getByRole("button", { name: /Bidder Check-In/ }));
    expect(screen.getAllByTestId(/archived-bidder-row-/)).toHaveLength(4);
  });

  it("names the missing Auction Items spreadsheet on the Catalog section instead of showing an empty list", async () => {
    mockSheets();
    render(<ArchivedYearPanel auction={{ ...full, itemsSpreadsheetId: null }} />);
    await screen.findByText(/chart:/);

    await userEvent.click(within(screen.getByRole("navigation", { name: "2026 auction sections" })).getByRole("button", { name: /Auction Catalog/ }));

    expect(screen.getByText(/has no "2026 Auction Items" spreadsheet/)).toBeInTheDocument();
    expect(getSheetData).not.toHaveBeenCalledWith(expect.anything(), "Auction-Items!A:Z");
  });

  it("lists active items with no winner under No Bid Items, leaving out won items, inactive items and multi-winner items like raffle tickets", async () => {
    mockSheets();
    render(<ArchivedYearPanel auction={full} />);
    await screen.findByText(/chart:/);
    const rail = screen.getByRole("navigation", { name: "2026 auction sections" });

    await userEvent.click(within(rail).getByRole("button", { name: /No Bid Items/ }));

    expect(screen.getByTestId("item-row-103")).toHaveTextContent("No winner");
    expect(screen.queryByTestId("item-row-101")).not.toBeInTheDocument();
    expect(screen.queryByTestId("item-row-102")).not.toBeInTheDocument();
    expect(screen.queryByTestId("item-row-1501")).not.toBeInTheDocument();
  });
});
