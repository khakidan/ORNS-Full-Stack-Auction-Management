/**
 * @vitest-environment jsdom
 *
 * Registering a walk-in (ROADMAP T7): the real dialog and the real
 * useWalkInForm hook, with only the API call mocked - so the test is about
 * what a person typing into the form actually sends.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalkInTicketDialog } from "./WalkInTicketDialog";
import { useWalkInForm } from "@/hooks/useWalkInForm";
import { postJson, HttpError } from "@/services/apiClient";
import { toast } from "sonner";

vi.mock("@/services/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/apiClient")>()),
  postJson: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(() => "loading-toast") },
}));

const fetchBidders = vi.fn(async () => {});
const fetchAttendees = vi.fn(async () => {});

function WalkIn({ ticketsSpreadsheetId = "tickets-sheet" }: { ticketsSpreadsheetId?: string }) {
  const w = useWalkInForm({
    fetchBidders, fetchAttendees,
    spreadsheetId: "bm-sheet", ticketsSpreadsheetId, ticketPrice: "35",
    bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers",
  });
  return (
    <WalkInTicketDialog open={w.isWalkInOpen} onOpenChange={w.setIsWalkInOpen} form={w.walkInForm}
      onFormChange={w.setWalkInForm} onSubmit={w.handleWalkInSubmit} isSubmitting={w.isSubmittingWalkIn} />
  );
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New Walk-In Ticket" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(screen.getByLabelText("First Name"), "Pat");
  await user.type(screen.getByLabelText("Last Name"), "Lee");
  await user.type(screen.getByLabelText("Email"), "pat@example.com");
  return dialog;
}

beforeEach(() => {
  vi.mocked(postJson).mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  fetchBidders.mockClear();
  fetchAttendees.mockClear();
});

describe("registering a walk-in", () => {
  it("sends the typed name and email with the Config's spreadsheets and ticket price, then closes and shows the new bidder", async () => {
    vi.mocked(postJson).mockResolvedValue({ success: true, bidder: { id: "142", firstName: "Pat", lastName: "Lee" }, ticketAppended: true });
    const user = userEvent.setup();
    render(<WalkIn />);

    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create Ticket" }));

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith("/api/bidders/walk-in", {
      firstName: "Pat",
      lastName: "Lee",
      email: "pat@example.com",
      spreadsheetId: "bm-sheet",
      ticketsSpreadsheetId: "tickets-sheet",
      ticketPrice: "35",
      bidderNumbersSheet: "Bidder-Numbers",
      bidManagementSheet: "Bid-Management",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }, "Failed to create walk-in ticket");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Pat Lee"), { id: "loading-toast", duration: 5000 });
    expect(fetchBidders).toHaveBeenCalledTimes(1);
    expect(fetchAttendees).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("starts the next walk-in with an empty form", async () => {
    vi.mocked(postJson).mockResolvedValue({ success: true, bidder: { id: "142", firstName: "Pat", lastName: "Lee" }, ticketAppended: true });
    const user = userEvent.setup();
    render(<WalkIn />);
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create Ticket" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New Walk-In Ticket" }));

    expect(await screen.findByLabelText("First Name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("keeps the dialog open with the server's reason when it refuses", async () => {
    vi.mocked(postJson).mockRejectedValue(new HttpError("[Walk-In] Could not find required sheets. Please verify settings.", 400, {}));
    const user = userEvent.setup();
    render(<WalkIn />);

    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create Ticket" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Error: [Walk-In] Could not find required sheets. Please verify settings.", { id: "loading-toast" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("First Name")).toHaveValue("Pat");
    expect(screen.getByRole("button", { name: "Create Ticket" })).toBeEnabled();
    expect(fetchBidders).not.toHaveBeenCalled();
  });

  it("sends once when Create Ticket is clicked again while the first is still going", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(postJson).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<WalkIn />);
    await fillIn(user);

    await user.click(screen.getByRole("button", { name: "Create Ticket" }));
    const busy = screen.getByRole("button", { name: /Creating/ });
    expect(busy).toBeDisabled();
    await user.click(busy);

    expect(postJson).toHaveBeenCalledTimes(1);
    finish({ success: true, bidder: { id: "142", firstName: "Pat", lastName: "Lee" }, ticketAppended: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("warns staff to check the Tickets sheet when the bidder was made but the ticket row wasn't", async () => {
    vi.mocked(postJson).mockResolvedValue({ success: true, bidder: { id: "142", firstName: "Pat", lastName: "Lee" }, ticketAppended: false, appendError: "Quota exceeded" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<WalkIn />);

    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create Ticket" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Quota exceeded")));
    vi.mocked(console.warn).mockRestore();
  });

  it("doesn't warn about the Tickets sheet when there isn't one", async () => {
    vi.mocked(postJson).mockResolvedValue({ success: true, bidder: { id: "142", firstName: "Pat", lastName: "Lee" }, ticketAppended: false });
    const user = userEvent.setup();
    render(<WalkIn ticketsSpreadsheetId="" />);

    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create Ticket" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
