// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchiveAuctionCard from "./ArchiveAuctionCard";
import { postJson } from "@/services/apiClient";
import { toast } from "sonner";
import { Config } from "@/types";

vi.mock("@/services/apiClient", () => ({ postJson: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const config = {
  auctionTicketsSpreadsheetId: "https://docs.google.com/spreadsheets/d/tk123/edit",
  auctionItemsSpreadsheetId: "it123",
  bidManagementSpreadsheetId: "bm123",
} as Config;

describe("ArchiveAuctionCard", () => {
  beforeEach(() => { vi.mocked(postJson).mockReset(); vi.mocked(toast.success).mockReset(); vi.mocked(toast.error).mockReset(); });

  it("sends the chosen year with the bare spreadsheet IDs and links to the archive folder it reports", async () => {
    vi.mocked(postJson).mockResolvedValue({
      success: true, year: 2026, folderLink: "https://drive.google.com/drive/folders/f26",
      results: [{ name: "a", status: "copied" }, { name: "b", status: "copied" }, { name: "c", status: "copied" }],
    });
    render(<ArchiveAuctionCard config={config} />);
    const year = screen.getByLabelText("Auction year");
    await userEvent.clear(year);
    await userEvent.type(year, "2026");

    await userEvent.click(screen.getByRole("button", { name: /Archive Auction/ }));

    expect(postJson).toHaveBeenCalledWith(
      "/api/auction/archive",
      { year: 2026, ticketsSpreadsheetId: "tk123", itemEntrySpreadsheetId: "it123", bidManagementSpreadsheetId: "bm123" },
      expect.any(String)
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archived the 2026 auction (3 spreadsheets)."));
    expect(screen.getByRole("link", { name: /Open the archive folder/ })).toHaveAttribute("href", "https://drive.google.com/drive/folders/f26");
  });

  it("reports which spreadsheet failed to copy instead of claiming success", async () => {
    vi.mocked(postJson).mockResolvedValue({
      success: false, year: 2026, folderLink: "x",
      results: [{ name: "2026 Bid Management", status: "failed", error: "quota" }],
    });
    render(<ArchiveAuctionCard config={config} />);

    await userEvent.click(screen.getByRole("button", { name: /Archive Auction/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("2026 Bid Management (quota)")));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("won't archive until the year is four digits", async () => {
    render(<ArchiveAuctionCard config={config} />);
    const year = screen.getByLabelText("Auction year");
    await userEvent.clear(year);
    await userEvent.type(year, "26");

    expect(screen.getByRole("button", { name: /Archive Auction/ })).toBeDisabled();
  });
});
