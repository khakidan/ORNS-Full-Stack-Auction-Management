// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActionHistoryAdmin from "./ActionHistoryAdmin";
import { fetchWithRetry } from "@/services/google-api";
import { postJson } from "@/services/apiClient";
import { toast } from "sonner";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
  errorTextFrom: (d: any, f: string) => d?.error || f,
}));
vi.mock("@/services/apiClient", () => ({ postJson: vi.fn() }));
const CONFIG = { auctionItemsSpreadsheetId: "it-sheet", auctionTicketsSpreadsheetId: "tk-sheet" };
const mockCheckForChanges = vi.fn(async () => {});
let mockAuction = { dataVersion: 0, lastChangedKeys: [] as string[], checkForChanges: mockCheckForChanges };
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => mockAuction }));
vi.mock("@/context/ConfigContext", () => ({ useConfig: () => ({ config: CONFIG }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{typeof children === "string" ? children : value}</option>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

const base = { timestamp: "2026-03-14T23:42:00Z", role: "", location: "", before: "", after: "", undoOf: "", undo: "" };
const ACTIONS = [
  { ...base, id: "a3", who: "kim@yahoo.com", source: "App", area: "Bid Management", action: "Record winning bid", target: "Item 312", summary: "Bidder 104 won item 312 for $150.00", undoable: true, after: '{"itemId":"312","price":150}' },
  { ...base, id: "a2", who: "jane@orns.org", source: "App", area: "Auction Items", action: "Edit item", target: "Vase", summary: "Edited \"Vase\": value", undoable: true },
  { ...base, id: "a1", who: "director@orns.org", source: "Sheet edit", area: "Tickets", action: "Sheet edit", target: "tickets!F57", summary: "Edited F57", undoable: false, undo: "Can't be undone: several cells were edited at once" },
];
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response;

describe("ActionHistoryAdmin", () => {
  beforeEach(() => {
    vi.mocked(fetchWithRetry).mockReset().mockResolvedValue(json({ spreadsheetId: "log", url: "https://docs/log", actions: ACTIONS }));
    vi.mocked(postJson).mockReset();
    mockCheckForChanges.mockClear();
    mockAuction = { dataVersion: 0, lastChangedKeys: [], checkForChanges: mockCheckForChanges };
  });

  it("offers to create the spreadsheet when there isn't one yet", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ spreadsheetId: "", actions: [] }));
    vi.mocked(postJson).mockResolvedValue({ spreadsheetId: "log" });
    render(<ActionHistoryAdmin />);

    await userEvent.click(await screen.findByRole("button", { name: /Create Action History spreadsheet/ }));

    expect(postJson).toHaveBeenCalledWith("/api/action-history/create", {}, expect.any(String));
  });

  it("lists actions newest first with who did them, and the reason when one can't be undone", async () => {
    render(<ActionHistoryAdmin />);

    const first = await screen.findByTestId("action-row-a3");
    expect(within(first).getByText(/kim@yahoo.com/)).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /Undo/ })).toBeInTheDocument();
    const sheetEdit = screen.getByTestId("action-row-a1");
    expect(within(sheetEdit).getByText(/edited in the spreadsheet/)).toBeInTheDocument();
    expect(within(sheetEdit).getByText("Can't be undone: several cells were edited at once")).toBeInTheDocument();
    expect(within(sheetEdit).queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
  });

  it("filters by person and by search", async () => {
    render(<ActionHistoryAdmin />);
    await screen.findByTestId("action-row-a3");

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "jane@orns.org" } });
    expect(screen.queryByTestId("action-row-a3")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-row-a2")).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "all" } });
    await userEvent.type(screen.getByPlaceholderText("Search actions..."), "item 312");
    expect(screen.getByTestId("action-row-a3")).toBeInTheDocument();
    expect(screen.queryByTestId("action-row-a2")).not.toBeInTheDocument();
  });

  it("shows Before and After when a row is expanded", async () => {
    render(<ActionHistoryAdmin />);
    const row = await screen.findByTestId("action-row-a3");

    await userEvent.click(within(row).getByRole("button", { name: "Show details" }));

    expect(within(row).getByText(/"price": 150/)).toBeInTheDocument();
  });

  it("asks before undoing, then undoes; a refusal is shown with the server's reason", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ success: true });
    render(<ActionHistoryAdmin />);
    await userEvent.click(within(await screen.findByTestId("action-row-a3")).getByRole("button", { name: /Undo/ }));

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/action-history/a3/undo", {}, expect.any(String)));
    // The undone change shows on this screen straight away, not on the next live-refresh tick.
    await waitFor(() => expect(mockCheckForChanges).toHaveBeenCalled());

    vi.mocked(postJson).mockRejectedValueOnce(new Error("This has changed since, so undoing it would overwrite a later change."));
    await userEvent.click(within(screen.getByTestId("action-row-a2")).getByRole("button", { name: /Undo/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("changed since"), expect.anything()));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("turns on edit tracking for the configured Items and Tickets spreadsheets", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ success: true, results: [{ name: "Auction Items", success: true }, { name: "Auction Tickets", success: true }] });
    render(<ActionHistoryAdmin />);

    await userEvent.click(await screen.findByRole("button", { name: /Turn on edit tracking/ }));

    expect(postJson).toHaveBeenCalledWith("/api/action-history/edit-tracking", { enabled: true, itemsSpreadsheetId: "it-sheet", ticketsSpreadsheetId: "tk-sheet" }, expect.any(String));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("now recorded")));
  });

  it("offers Turn off when edit tracking is already on, and turns it off", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (url: any) =>
      String(url).endsWith("/edit-tracking") ? json({ on: true }) : json({ spreadsheetId: "log", url: "https://docs/log", actions: ACTIONS }));
    vi.mocked(postJson).mockResolvedValueOnce({ success: true, results: [{ name: "Auction Items", success: true }, { name: "Auction Tickets", success: true }] });
    render(<ActionHistoryAdmin />);

    await userEvent.click(await screen.findByRole("button", { name: /Turn off edit tracking/ }));

    expect(postJson).toHaveBeenCalledWith("/api/action-history/edit-tracking", { enabled: false, itemsSpreadsheetId: "it-sheet", ticketsSpreadsheetId: "tk-sheet" }, expect.any(String));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("no longer recorded")));
  });

  it("reloads the list quietly when someone else's action arrives (live refresh)", async () => {
    const { rerender } = render(<ActionHistoryAdmin />);
    await screen.findByTestId("action-row-a3");
    vi.mocked(fetchWithRetry).mockClear();

    mockAuction = { ...mockAuction, dataVersion: 1, lastChangedKeys: ["bm-sheet"] };
    rerender(<ActionHistoryAdmin />);
    expect(fetchWithRetry).not.toHaveBeenCalled();

    mockAuction = { ...mockAuction, dataVersion: 2, lastChangedKeys: ["action-history"] };
    rerender(<ActionHistoryAdmin />);
    await waitFor(() => expect(fetchWithRetry).toHaveBeenCalledWith("/api/action-history", expect.anything()));
    expect(screen.getByTestId("action-row-a3")).toBeInTheDocument();
  });
});
