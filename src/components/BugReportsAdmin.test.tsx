// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BugReportsAdmin from "./BugReportsAdmin";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ reports: [] }) }),
  getBaseUrl: vi.fn(() => "http://localhost:3000")
}));

// Overridable per-test via mockBugReportsSpreadsheetId, reset in
// afterEach - lets the "not configured" test below use a real, distinct
// render rather than a fragile vi.doMock/vi.resetModules dance mid-file.
let mockBugReportsSpreadsheetId = "mock-spreadsheet-id";
vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: { bugReportsSpreadsheetId: mockBugReportsSpreadsheetId }
  })
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const mockReports = [
  {
    reportId: "report-1",
    timestamp: "2026-09-04T05:07:13.370Z",
    status: "Open",
    type: "UI Issue",
    title: "Clipping of Circular Checked In State",
    description: "The visual representation is getting clipped.",
    route: "/BidManagement (workflow: bids, tab: dashboard)",
    appState: "Bidders: 16",
    browserInfo: "User-Agent: test",
    consoleActivity: "(none captured)",
    screenshotLink: "",
  },
  {
    reportId: "report-2",
    timestamp: "2026-09-04T06:00:00.000Z",
    status: "Open",
    type: "Bug",
    title: "Payload too large",
    description: "413 error on submit.",
    route: "/test",
    appState: "",
    browserInfo: "",
    consoleActivity: "",
    screenshotLink: "https://drive.google.com/file/d/abc/view",
  },
];

describe("BugReportsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
    mockBugReportsSpreadsheetId = "mock-spreadsheet-id";
  });

  it("renders the open report list, including title and route", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ reports: mockReports }),
    } as Response);

    render(<BugReportsAdmin />);

    expect(await screen.findByText("Clipping of Circular Checked In State")).toBeInTheDocument();
    expect(screen.getByText("Payload too large")).toBeInTheDocument();
    expect(screen.getByText("/BidManagement (workflow: bids, tab: dashboard)")).toBeInTheDocument();
  });

  it("fetches from the real list endpoint with the configured spreadsheet ID", async () => {
    render(<BugReportsAdmin />);

    await waitFor(() => {
      expect(fetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("/api/bug-reports/list?spreadsheetId=mock-spreadsheet-id"),
        { credentials: "include" }
      );
    });
  });

  it("shows the empty state when there are no open reports", async () => {
    render(<BugReportsAdmin />);

    expect(await screen.findByText("No open bug reports.")).toBeInTheDocument();
  });

  it("only shows a Screenshot link for reports that actually have one", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ reports: mockReports }),
    } as Response);

    render(<BugReportsAdmin />);

    await screen.findByText("Payload too large");
    // Only report-2 has a screenshotLink, so exactly one Screenshot button.
    expect(screen.getAllByText("Screenshot")).toHaveLength(1);
  });

  it("Resolve posts the real payload and removes the row from the list on success", async () => {
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ reports: mockReports }) } as Response) // initial list
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) } as Response); // resolve call

    render(<BugReportsAdmin />);
    await screen.findByText("Clipping of Circular Checked In State");

    const resolveButtons = screen.getAllByText("Resolve");
    await userEvent.click(resolveButtons[0]);

    await waitFor(() => {
      expect(fetchWithRetry).toHaveBeenCalledWith(
        "http://localhost:3000/api/bug-reports/resolve",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spreadsheetId: "mock-spreadsheet-id", reportId: "report-1" }),
          credentials: "include",
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Clipping of Circular Checked In State")).not.toBeInTheDocument();
    });
    // The other, un-resolved report must still be there.
    expect(screen.getByText("Payload too large")).toBeInTheDocument();
  });

  it("Refresh button triggers a new fetch", async () => {
    render(<BugReportsAdmin />);

    await screen.findByText("No open bug reports.");
    vi.mocked(fetchWithRetry).mockClear();

    await userEvent.click(screen.getByText("Refresh"));

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/api/bug-reports/list?spreadsheetId=mock-spreadsheet-id"),
      { credentials: "include" }
    );
  });

  it("View opens the detail dialog for the clicked report", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ reports: mockReports }),
    } as Response);

    render(<BugReportsAdmin />);
    await screen.findByText("Clipping of Circular Checked In State");

    const viewButtons = screen.getAllByText("View");
    await userEvent.click(viewButtons[1]); // report-2, "Payload too large"

    expect(await screen.findByText("Copy as Markdown")).toBeInTheDocument();
    expect(screen.getByText("413 error on submit.")).toBeInTheDocument();
  });

  it("shows the not-configured placeholder instead of fetching when no Bug Reports spreadsheet ID is set", async () => {
    mockBugReportsSpreadsheetId = "";

    render(<BugReportsAdmin />);

    expect(await screen.findByText("No Bug Reports Spreadsheet Configured")).toBeInTheDocument();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  // Regression guard for a user-reported bug: a long Title (or Route) cell
  // used to push the table wider than its container, shoving the Actions
  // column's Resolve button off the visible/scrolled area. The table now
  // uses a fixed layout with per-column widths, and the Title/Route cells
  // wrap instead of truncating or forcing a single line - both together
  // keep every column, including Actions, within its assigned width no
  // matter how long the content is.
  it("wraps a long title instead of truncating it, and keeps the table on a fixed column layout", async () => {
    const longTitle = "A".repeat(200);
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ reports: [{ ...mockReports[0], title: longTitle }] }),
    } as Response);

    render(<BugReportsAdmin />);

    const titleCell = await screen.findByText(longTitle);
    expect(titleCell.className).not.toContain("truncate");
    expect(titleCell.className).toContain("whitespace-normal");
    expect(titleCell.className).toContain("break-words");

    const table = document.querySelector("table");
    expect(table?.className).toContain("table-fixed");

    // The Resolve button must still be present and reachable in the DOM -
    // not just scrolled out of view, which the fixed layout guarantees is
    // the only way it can go off-screen (a real overflow test needs an
    // actual browser layout engine, which jsdom doesn't provide).
    expect(screen.getByText("Resolve")).toBeInTheDocument();
  });
});
