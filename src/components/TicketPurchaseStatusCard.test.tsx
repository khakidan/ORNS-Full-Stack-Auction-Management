/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TicketPurchaseStatusCard from "./TicketPurchaseStatusCard";
import { useTicketPurchaseStatus } from "@/hooks/useTicketPurchaseStatus";
import { TicketPurchaseStatus } from "@/types";

/** The card as the Tickets page uses it: the page holds the status. */
function StatusCard({ onAdded }: { onAdded: () => void }) {
  return <TicketPurchaseStatusCard attendees={[]} purchases={useTicketPurchaseStatus(onAdded)} />;
}

vi.mock("@/services/google-api", () => ({
  getTicketPurchaseStatus: vi.fn(),
  checkWebsiteTicketsNow: vi.fn(),
  markLateWebsitePurchaseHandled: vi.fn(async () => {}),
  clearWebsitePurchaseReview: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getTicketPurchaseStatus, checkWebsiteTicketsNow, markLateWebsitePurchaseHandled, clearWebsitePurchaseReview } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetStatus = vi.mocked(getTicketPurchaseStatus);
const mockedCheckNow = vi.mocked(checkWebsiteTicketsNow);

const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const status = (overrides: Partial<TicketPurchaseStatus> = {}): TicketPurchaseStatus => ({
  configured: true,
  mode: "write",
  lastWebhook: { at: recent, entryId: "1490", outcome: "added" },
  poll: { lastSuccessAt: recent, lastRunAt: recent, lastRunErrors: [], seasonStartEntryId: 1482 },
  missed: [],
  submittedAt: {},
  review: [],
  afterGoLive: [],
  ...overrides,
});
const run = (overrides = {}) => ({ at: recent, mode: "write" as const, newEntries: 0, added: [], wouldAdd: [], needsReview: [], paymentsSet: [], paymentsWouldSet: [], paymentsNeedReview: [], errors: [], ...overrides });

describe("TicketPurchaseStatusCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Working when the webhook and the check are healthy", async () => {
    mockedGetStatus.mockResolvedValue(status());
    render(<StatusCard onAdded={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Working")).toBeInTheDocument());
    expect(screen.getByText(/Entry 1490: added to the sheet/)).toBeInTheDocument();
  });

  it("needs attention with a purchase to review, the missed entries listed", async () => {
    mockedGetStatus.mockResolvedValue(status({
      missed: [{ entryId: "1485", at: recent }, { entryId: "1488", at: recent }],
      review: [{ entryId: "1491", name: "Pat Lee", problems: ["4 guests for 2 tickets"], firstSeenAt: recent, lastSeenAt: recent }],
    }));
    render(<StatusCard onAdded={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Needs Attention")).toBeInTheDocument());
    expect(screen.getByText(/Pat Lee \(entry 1491\)/)).toBeInTheDocument();
    expect(screen.getByText("Entries 1485, 1488")).toBeInTheDocument();
  });

  it("Clear takes a sorted-out purchase off the review list", async () => {
    const user = userEvent.setup();
    mockedGetStatus.mockResolvedValueOnce(status({ review: [{ entryId: "1488", name: "Pat Lee", problems: ["PayPal says payment X is REFUNDED, not completed."], firstSeenAt: recent, lastSeenAt: recent }] }));
    mockedGetStatus.mockResolvedValue(status());
    render(<StatusCard onAdded={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Clear entry 1488" }));

    await waitFor(() => expect(clearWebsitePurchaseReview).toHaveBeenCalledWith("1488"));
    await waitFor(() => expect(screen.queryByText(/Pat Lee \(entry 1488\)/)).not.toBeInTheDocument());
  });

  it("lists purchases that arrived after Go Live for staff to register as walk-ins, and Done takes one off", async () => {
    const user = userEvent.setup();
    mockedGetStatus.mockResolvedValueOnce(status({ afterGoLive: [{ entryId: "1500", name: "Pat Lee", tickets: 2, guestsWantingNumbers: ["Sam Lee"], paymentStatus: "Pending", state: "live", at: recent }] }));
    mockedGetStatus.mockResolvedValue(status());
    render(<StatusCard onAdded={vi.fn()} />);

    expect(await screen.findByText("Needs Attention")).toBeInTheDocument();
    expect(screen.getByText("Bought after Go Live - register as walk-ins")).toBeInTheDocument();
    expect(screen.getByText(/2 ticket\(s\), paying at the door/)).toBeInTheDocument();
    expect(screen.getByText("Also a bidder number for: Sam Lee")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(markLateWebsitePurchaseHandled).toHaveBeenCalledWith("1500"));
    await waitFor(() => expect(screen.queryByText("Bought after Go Live - register as walk-ins")).not.toBeInTheDocument());
  });

  it("says when the Fluent Forms API isn't set up, without a Check Now button", async () => {
    mockedGetStatus.mockResolvedValue(status({ configured: false, poll: null }));
    render(<StatusCard onAdded={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Not Set Up")).toBeInTheDocument());
    expect(screen.queryByText("Check Now")).not.toBeInTheDocument();
  });

  it("Check Now runs the check and reloads the attendee list when it added a row", async () => {
    const user = userEvent.setup();
    mockedGetStatus.mockResolvedValue(status());
    mockedCheckNow.mockResolvedValue(run({ newEntries: 1, added: ["1492"] }));
    const onAdded = vi.fn();
    render(<StatusCard onAdded={onAdded} />);
    await user.click(await screen.findByRole("button", { name: "Check Now" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("1 new, 1 missing from the sheet"));
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);
  });

  it("Check Now shows why a check stopped", async () => {
    const user = userEvent.setup();
    mockedGetStatus.mockResolvedValue(status());
    mockedCheckNow.mockResolvedValue(run({ errors: ["WordPress said no"] }));
    const onAdded = vi.fn();
    render(<StatusCard onAdded={onAdded} />);
    await user.click(await screen.findByRole("button", { name: "Check Now" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The check stopped: WordPress said no"));
    expect(onAdded).not.toHaveBeenCalled();
  });
});
