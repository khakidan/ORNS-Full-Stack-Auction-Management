/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketPurchaseStatus } from "@/types";

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

let mockCan = true;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => mockCan }) }));
vi.mock("@/context/ConfigContext", () => ({ useConfig: () => ({ config: { auctionTicketsSpreadsheetId: "" } }) }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => ({ auctionState: "prep", attendees: [], fetchAttendees: vi.fn() }) }));
vi.mock("./TicketAttendeeTab", () => ({ default: () => <div>Attendee list</div> }));
vi.mock("./TicketDocumentCreationTab", () => ({ default: () => <div>Documents</div> }));
vi.mock("@/services/google-api", () => ({ getTicketPurchaseStatus: vi.fn(), checkWebsiteTicketsNow: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import AuctionTicketsWorkflow from "./AuctionTicketsWorkflow";
import { getTicketPurchaseStatus } from "@/services/google-api";

const mockedGetStatus = vi.mocked(getTicketPurchaseStatus);
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const status = (overrides: Partial<TicketPurchaseStatus> = {}): TicketPurchaseStatus => ({
  configured: true,
  mode: "write",
  lastWebhook: { at: recent, entryId: "1490", outcome: "added" },
  poll: { lastSuccessAt: recent, lastRunAt: recent, lastRunErrors: [], seasonStartEntryId: 1482 },
  missed: [],
  submittedAt: {},
  review: [],
  ...overrides,
});

describe("AuctionTicketsWorkflow - Website Purchases tab (ROADMAP W6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan = true;
  });

  it("gives staff a Website Purchases tab, off the attendee list, with no dot while all is well", async () => {
    mockedGetStatus.mockResolvedValue(status());
    render(<AuctionTicketsWorkflow />);

    await waitFor(() => expect(mockedGetStatus).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Website Purchases" })).toBeInTheDocument();
    expect(screen.queryByText("Website Ticket Purchases")).not.toBeInTheDocument();
  });

  it("flags the tab when something needs attention, and the card is one click away", async () => {
    mockedGetStatus.mockResolvedValue(status({ review: [{ entryId: "1491", name: "Pat Lee", problems: ["x"], firstSeenAt: recent, lastSeenAt: recent }] }));
    const user = userEvent.setup();
    render(<AuctionTicketsWorkflow />);

    const tab = await screen.findByRole("tab", { name: "Website Purchases Needs attention" });
    await user.click(tab);

    expect(await screen.findByText("Website Ticket Purchases")).toBeVisible();
    expect(screen.getByText(/Pat Lee \(entry 1491\)/)).toBeInTheDocument();
  });

  it("isn't there for volunteers, and doesn't ask the server", () => {
    mockCan = false;
    render(<AuctionTicketsWorkflow />);

    expect(screen.queryByRole("tab", { name: /Website Purchases/ })).not.toBeInTheDocument();
    expect(mockedGetStatus).not.toHaveBeenCalled();
  });
});
