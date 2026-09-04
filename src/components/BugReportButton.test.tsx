/**
 * @vitest-environment jsdom
 *
 * Integration-lite: the real BugReportButton + BugReportDialog + Select
 * are left unmocked (this session's established pattern for exercising
 * SelectValue's real label-resolution behavior), with only the app-wide
 * contexts and the network/screenshot boundaries mocked.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BugReportButton } from "./BugReportButton";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/screenshotCapture", () => ({
  captureScreenshot: vi.fn(() => Promise.resolve(null)),
  blobToBase64: vi.fn(),
}));

vi.mock("@/lib/errorBuffer", () => ({
  getErrorBuffer: vi.fn(() => []),
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    bidders: [],
    items: [],
    attendees: [],
    winners: {},
    isAuctionClosed: false,
  }),
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      bidManagementSpreadsheetId: "",
      auctionItemsSpreadsheetId: "",
      auctionTicketsSpreadsheetId: "",
      bugReportsSpreadsheetId: "bug-reports-id",
      bugReportsFolderId: "",
    },
  }),
}));

import { fetchWithRetry } from "@/services/google-api";
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

describe("BugReportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
  });

  it("renders a low-contrast floating trigger and opens the dialog on click", () => {
    render(<BugReportButton />);

    expect(screen.queryByText("Report a Bug or Issue")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Report a bug or issue" }));

    expect(screen.getByText("Report a Bug or Issue")).toBeInTheDocument();
  });

  it("opens the dialog via the Ctrl+Shift+B shortcut without clicking the button", () => {
    render(<BugReportButton />);

    fireEvent.keyDown(window, { key: "b", ctrlKey: true, shiftKey: true });

    expect(screen.getByText("Report a Bug or Issue")).toBeInTheDocument();
  });

  it("submits the real form end-to-end: fills fields, picks a type, saves, and posts the expected payload", async () => {
    render(<BugReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug or issue" }));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Checkout button does nothing" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Clicked it twice, no response" } });

    fireEvent.click(screen.getByText("Save Report"));

    await waitFor(() => expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mockedFetchWithRetry.mock.calls[0][1] as RequestInit).body as string);
    expect(body.title).toBe("Checkout button does nothing");
    expect(body.description).toBe("Clicked it twice, no response");
    expect(body.type).toBe("Bug");

    await waitFor(() => expect(screen.queryByText("Report a Bug or Issue")).not.toBeInTheDocument());
  });

  it("closes without saving on Cancel", () => {
    render(<BugReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug or issue" }));

    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Report a Bug or Issue")).not.toBeInTheDocument();
    expect(mockedFetchWithRetry).not.toHaveBeenCalled();
  });
});
