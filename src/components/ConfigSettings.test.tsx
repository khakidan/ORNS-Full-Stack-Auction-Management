/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import ConfigSettings from "./ConfigSettings";
import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

// Card mock must forward onClick so the collapsible CardHeader
// state toggles fire correctly via fireEvent.click + event bubbling
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardHeader: ({ children, onClick, className }: any) => (
    <div onClick={onClick} className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
}));

// Prevent Radix Dialog portal from causing JSDOM issues
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

// Defined outside the mock factory so it is always the same object
// reference across renders. ConfigSettings has a useEffect with
// [remoteConfig] as its dependency — if the mock returns a new object
// on every render, it creates an infinite render loop and the tests hang.
const mockConfig = {
  auctionItemsSpreadsheetId: "mock-items-id",
  auctionTicketsSpreadsheetId: "mock-tickets-id",
  bidManagementSpreadsheetId: "mock-bid-mgt-id",
  auctionItemsScriptId: "mock-items-script",
  auctionTicketsScriptId: "mock-tickets-script",
  bidManagementScriptId: "mock-bid-mgt-script",
  ticketPrice: "35",
  bidderNumbersSheet: "Bidder-Numbers",
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "mock-receipts-folder",
  forPrintFolderId: "mock-print-folder",
  ornsLogoId: "mock-logo-id",
  bugReportsSpreadsheetId: "mock-bug-reports-id",
  bugReportsFolderId: "mock-bug-reports-folder",
};

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({ isAuctionClosed: false }),
}));

// BugReportsAdmin has its own tests; it only needs to render here.
vi.mock("./BugReportsAdmin", () => ({ default: () => <div>BugReportsAdmin</div> }));
vi.mock("./UsersAdmin", () => ({ default: () => <div>UsersAdmin</div> }));
vi.mock("./ActionHistoryAdmin", () => ({ default: () => <div>ActionHistoryAdmin</div> }));

const mockSaveConfig = vi.fn().mockResolvedValue(undefined);

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: mockConfig,
    saveConfig: mockSaveConfig,
    loading: false,
  }),
}));

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  getSheetData: vi.fn().mockResolvedValue({ values: [] }),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
    info: vi.fn(),
  },
}));

describe("ConfigSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.localStorage directly — localStorage is undefined in this
    // JSDOM environment so vi.spyOn(Storage.prototype) alone is not enough
    Object.defineProperty(window, "localStorage", {
      value: {
        setItem: vi.fn(),
        getItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: vi.fn(), origin: "http://localhost:3000" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the ticket price field and save button without any expansion", () => {
    render(<ConfigSettings />);
    // Ticket Pricing card is always visible — not inside a collapsible
    expect(screen.getByLabelText("Walk-In Ticket Price ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Walk-In Ticket Price ($)")).toHaveValue(35);
    expect(screen.getByText("Save Configuration")).toBeInTheDocument();
  });

  it("expanding Auction Configuration reveals all spreadsheet ID fields", () => {
    render(<ConfigSettings />);
    // Click the CardTitle text — bubbles up to CardHeader onClick
    fireEvent.click(screen.getByText("Auction Configuration"));

    expect(screen.getByLabelText("1. Auction Item Data Entry Spreadsheet ID")).toBeInTheDocument();
    expect(screen.getByLabelText("2. Auction Tickets Spreadsheet ID")).toBeInTheDocument();
    expect(screen.getByLabelText("3. Bid Management Spreadsheet ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Bug Reports Spreadsheet ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Bug Reports Screenshots Folder ID")).toBeInTheDocument();
  });

  it("has no Script ID boxes or Apps Script section - the server uses its own SCRIPT_ID_* settings, so editing them here changed nothing", () => {
    render(<ConfigSettings />);
    fireEvent.click(screen.getByText("Auction Configuration"));

    expect(screen.queryByLabelText(/Script ID/)).not.toBeInTheDocument();
    expect(screen.queryByText("Google Apps Script Workflows")).not.toBeInTheDocument();
    expect(screen.queryByText(/They can't be changed here/)).not.toBeInTheDocument();
  });

  it("fields display current config values from useConfig", () => {
    render(<ConfigSettings />);
    // ticketPrice is always visible
    expect(screen.getByLabelText("Walk-In Ticket Price ($)")).toHaveValue(35);

    // Expand Auction Configuration and check a few IDs
    fireEvent.click(screen.getByText("Auction Configuration"));
    expect(screen.getByLabelText("1. Auction Item Data Entry Spreadsheet ID")).toHaveValue("mock-items-id");
    expect(screen.getByLabelText("2. Auction Tickets Spreadsheet ID")).toHaveValue("mock-tickets-id");
    expect(screen.getByLabelText("3. Bid Management Spreadsheet ID")).toHaveValue("mock-bid-mgt-id");
  });

  it("clicking Save Configuration calls saveConfig with the current values", async () => {
    render(<ConfigSettings />);

    // Change ticket price — fireEvent works for controlled inputs
    fireEvent.change(screen.getByLabelText("Walk-In Ticket Price ($)"), {
      target: { value: "42" },
    });

    fireEvent.click(screen.getByText("Save Configuration"));

    // handleSave is async — wait for saveConfig to be called
    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ ticketPrice: "42" })
      );
    });
  });

  it("clicking Save Configuration extracts the bare ID from a pasted Google Sheets URL, not the raw URL", async () => {
    // Every existing "Save Configuration" test leaves the ID fields at
    // their already-clean fixture values, so extractId's URL-parsing
    // regex branches (useConfigSettingsState.ts) never actually fire -
    // handleSave would happily save a raw, unusable URL as the
    // "spreadsheet ID" without this.
    render(<ConfigSettings />);

    fireEvent.click(screen.getByText("Auction Configuration"));
    fireEvent.change(screen.getByLabelText("3. Bid Management Spreadsheet ID"), {
      target: { value: "https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit#gid=0" },
    });

    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ bidManagementSpreadsheetId: "1AbC-XyZ_123" })
      );
    });
  });

  it("clicking Save Configuration saves an edited Bug Reports spreadsheet/folder ID", async () => {
    render(<ConfigSettings />);

    fireEvent.click(screen.getByText("Auction Configuration"));
    fireEvent.change(screen.getByLabelText("Bug Reports Spreadsheet ID"), {
      target: { value: "https://docs.google.com/spreadsheets/d/1BugReports_XyZ/edit#gid=0" },
    });
    fireEvent.change(screen.getByLabelText("Bug Reports Screenshots Folder ID"), {
      target: { value: "https://drive.google.com/drive/folders/1BugScreenshots_XyZ" },
    });

    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          bugReportsSpreadsheetId: "1BugReports_XyZ",
          bugReportsFolderId: "1BugScreenshots_XyZ",
        })
      );
    });
  });

  it("after saving, copies the settings to the Bid-Management _Settings tab without complaint when every copy succeeds", async () => {
    render(<ConfigSettings />);
    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(fetchWithRetry).toHaveBeenCalledWith(expect.stringContaining("/api/settings/update"), expect.anything());
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("doesn't copy anything to the _Settings tab when the save itself is refused", async () => {
    mockSaveConfig.mockRejectedValueOnce(new Error("You don't have permission to do that."));
    render(<ConfigSettings />);
    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchWithRetry).not.toHaveBeenCalledWith(expect.stringContaining("/api/settings/update"), expect.anything());
  });

  it("shows a cloud-sync-failure toast, not the plain success toast, when a settings/update call returns a non-ok response - useConfigSettingsState.ts's syncSettingToCloud never checked res.ok, so a 4xx here used to be silently reported as full success", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (url) => {
      if (url.toString().includes("/api/settings/update")) {
        return { ok: false, status: 400, json: async () => ({ error: "Missing required fields" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<ConfigSettings />);
    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("couldn't be copied")
      );
    });
  });

  it("splits the Settings page into Configuration / PayPal Integration / Google Apps Scripts / Bug Reports tabs, each showing only its own content", async () => {
    const user = userEvent.setup();
    render(<ConfigSettings />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Configuration" })).toBeInTheDocument();
    expect(screen.getByText("Ticket Pricing")).toBeInTheDocument();
    expect(screen.queryByText("Apps Script Versions")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Google Apps Scripts" }));
    expect(screen.getByText("Apps Script Versions")).toBeInTheDocument();
    expect(screen.queryByText("Ticket Pricing")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Bug Reports" }));
    expect(screen.getByText("BugReportsAdmin")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Users" }));
    expect(screen.getByText("UsersAdmin")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "PayPal Integration" }));
    expect(screen.getByText("Save Configuration")).toBeInTheDocument();
  });
});
