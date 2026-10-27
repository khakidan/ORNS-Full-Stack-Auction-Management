// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchivedAuctionsWorkflow from "./ArchivedAuctionsWorkflow";
import { getArchivedAuctions } from "@/services/google-api";

vi.mock("@/services/google-api", () => ({ getArchivedAuctions: vi.fn(), getSheetData: vi.fn() }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => ({ isAuctionClosed: false }) }));
vi.mock("@/context/ConfigContext", () => ({ useConfig: () => ({ config: {} }) }));

const none = { folderId: null, folderLink: null, bidManagementSpreadsheetId: null, itemsSpreadsheetId: null };

describe("ArchivedAuctionsWorkflow", () => {
  beforeEach(() => { vi.mocked(getArchivedAuctions).mockReset(); });

  it("gives each of the past two years its own tab, and reports a year with nothing archived on that tab", async () => {
    vi.mocked(getArchivedAuctions).mockResolvedValue([{ year: 2026, ...none }, { year: 2025, ...none }]);
    render(<ArchivedAuctionsWorkflow />);

    expect(await screen.findByRole("tab", { name: "2026 Auction" })).toBeInTheDocument();
    expect(screen.getByText("Not enough information for the 2026 auction")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "2025 Auction" }));
    expect(screen.getByText("Not enough information for the 2025 auction")).toBeInTheDocument();
  });

  it("shows the reason when the archive lookup fails", async () => {
    vi.mocked(getArchivedAuctions).mockRejectedValue(new Error("Drive is down"));
    render(<ArchivedAuctionsWorkflow />);

    expect(await screen.findByText("Drive is down")).toBeInTheDocument();
  });
});
