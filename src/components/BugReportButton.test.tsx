/**
 * @vitest-environment jsdom
 *
 * Integration-lite: the real BugReportButton + BugReportDialog + Select
 * are left unmocked (this session's established pattern for exercising
 * SelectValue's real label-resolution behavior), with only the app-wide
 * contexts and the network/screenshot boundaries mocked.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("renders a low-contrast floating trigger and opens the dialog on click", async () => {
    const user = userEvent.setup();
    render(<BugReportButton />);

    expect(screen.queryByText("Report a Bug or Issue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report a bug or issue" }));

    expect(screen.getByText("Report a Bug or Issue")).toBeInTheDocument();
  });

  it("opens the dialog via the Ctrl+Shift+B shortcut without clicking the button", async () => {
    const user = userEvent.setup();
    render(<BugReportButton />);

    await user.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");

    expect(screen.getByText("Report a Bug or Issue")).toBeInTheDocument();
  });

  it("submits the real form end-to-end: fills fields, picks a type, saves, and posts the expected payload", async () => {
    const user = userEvent.setup();
    render(<BugReportButton />);
    await user.click(screen.getByRole("button", { name: "Report a bug or issue" }));

    await user.type(screen.getByLabelText("Title"), "Checkout button does nothing");
    await user.type(screen.getByLabelText("Description"), "Clicked it twice, no response");

    await user.click(screen.getByRole("button", { name: "Save Report" }));

    await waitFor(() => expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mockedFetchWithRetry.mock.calls[0][1] as RequestInit).body as string);
    expect(body.title).toBe("Checkout button does nothing");
    expect(body.description).toBe("Clicked it twice, no response");
    expect(body.type).toBe("Bug");

    await waitFor(() => expect(screen.queryByText("Report a Bug or Issue")).not.toBeInTheDocument());
  });

  it("closes without saving on Cancel", async () => {
    const user = userEvent.setup();
    render(<BugReportButton />);
    await user.click(screen.getByRole("button", { name: "Report a bug or issue" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Report a Bug or Issue")).not.toBeInTheDocument();
    expect(mockedFetchWithRetry).not.toHaveBeenCalled();
  });
});
