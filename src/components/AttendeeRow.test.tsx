/**
 * @vitest-environment jsdom
 *
 * User-reported bug: "The tabular layout of the Attendee List is ugly
 * compared to the rest of the app... it's also clunky to have the visual
 * spaces between the first and last name fields." AttendeeRow.tsx was
 * rewritten from a <table>-row of four separate inline EditableCells to
 * a single flexible row, with all field editing moved into
 * EditAttendeeDialog.tsx (opened via the pencil icon). This file replaces
 * the old inline-editing tests with coverage of the new row: it renders
 * (not edits) attendee info, and its Edit/Delete actions just report the
 * click back to the caller.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AttendeeRow } from "./AttendeeRow";
import { Attendee, Guest } from "@/types";

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    name: "Bob Guest",
    firstName: "Bob",
    lastName: "Guest",
    email: "bob@example.com",
    guestIndex: 1,
    ownBidderNumber: "",
    ...overrides,
  };
}

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: "tickets-0",
    sheet: "tickets",
    rowIndex: 2,
    firstName: "Alice",
    lastName: "One",
    email: "alice@example.com",
    phone: "555-0100",
    ticketsPurchased: "1",
    hasGuests: "yes",
    guestsInfo: [],
    paymentMethod: "Manual",
    paymentStatus: "Pending",
    totalPaid: "$0",
    ...overrides,
  };
}

function renderRow(overrides: Partial<Parameters<typeof AttendeeRow>[0]> = {}) {
  const onEdit = vi.fn();
  const onUpdatePaymentStatus = vi.fn();
  const onDeleteRequest = vi.fn();
  const attendee = overrides.attendee ?? makeAttendee();

  render(
    <AttendeeRow
      attendee={attendee}
      isAuctionClosed={false}
      canDelete={true}
      onEdit={onEdit}
      onUpdatePaymentStatus={onUpdatePaymentStatus}
      onDeleteRequest={onDeleteRequest}
      {...overrides}
    />
  );

  return { attendee, onEdit, onUpdatePaymentStatus, onDeleteRequest };
}

describe("AttendeeRow - display", () => {
  it("renders the attendee's first and last name", () => {
    renderRow({ attendee: makeAttendee({ firstName: "Alice", lastName: "One" }) });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
  });

  it("renders a source badge for each sheet", () => {
    const cases: [string, string][] = [
      ["tickets", "General"],
      ["sponsor tickets", "Sponsor"],
      ["staff tickets", "Staff"],
    ];
    cases.forEach(([sheet, label]) => {
      const { unmount } = render(
        <AttendeeRow
          attendee={makeAttendee({ sheet })}
          isAuctionClosed={false}
          canDelete={true}
          onEdit={vi.fn()}
          onUpdatePaymentStatus={vi.fn()}
          onDeleteRequest={vi.fn()}
        />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    });
  });

  it("renders guest chips combining each guest's first and last name", () => {
    renderRow({
      attendee: makeAttendee({
        guestsInfo: [makeGuest({ firstName: "Marcus", lastName: "Whitfield" })],
      }),
    });

    expect(screen.getByText("Marcus Whitfield")).toBeInTheDocument();
  });

  it("shows 'No guests listed' when there are no guests", () => {
    renderRow({ attendee: makeAttendee({ guestsInfo: [] }) });

    expect(screen.getByText("No guests listed")).toBeInTheDocument();
  });

  it("shows a title on a guest chip when they have their own bidder number", () => {
    renderRow({
      attendee: makeAttendee({
        guestsInfo: [makeGuest({ ownBidderNumber: "yes" })],
      }),
    });

    expect(screen.getByTitle("Has their own bidder number")).toBeInTheDocument();
  });

  it("shows the Paid pill and total when paid with a nonzero total", () => {
    renderRow({ attendee: makeAttendee({ paymentStatus: "Paid", totalPaid: "$140" }) });

    expect(screen.getByRole("button", { name: /paid/i })).toBeInTheDocument();
    expect(screen.getByText("Total: $140")).toBeInTheDocument();
  });

  it("shows the Pending pill and no total when unpaid", () => {
    renderRow({ attendee: makeAttendee({ paymentStatus: "Pending" }) });

    expect(screen.getByRole("button", { name: /pending/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Total:/)).not.toBeInTheDocument();
  });
});

describe("AttendeeRow - guests-exceed-tickets-purchased warning", () => {
  // User-reported data-quality bug: "we have a bidder who has purchased 1
  // ticket, but has 3 guests on their row... shouldn't allow a bidder to
  // have less tickets purchased than guests" - the exact repro is 1
  // ticket / 3 guests.
  it("shows a visible warning when guest count exceeds tickets purchased, naming the real numbers in its title", () => {
    renderRow({
      attendee: makeAttendee({
        ticketsPurchased: "1",
        guestsInfo: [makeGuest({ guestIndex: 1 }), makeGuest({ guestIndex: 2 }), makeGuest({ guestIndex: 3 })],
      }),
    });

    expect(screen.getByText("Guests exceed tickets")).toBeInTheDocument();
    expect(screen.getByTitle(/3 guests listed but only 1 ticket\(s\) purchased/)).toBeInTheDocument();
  });

  it("does not show a warning when guest count is within tickets purchased", () => {
    renderRow({
      attendee: makeAttendee({
        ticketsPurchased: "3",
        guestsInfo: [makeGuest({ guestIndex: 1 }), makeGuest({ guestIndex: 2 })],
      }),
    });

    expect(screen.queryByText("Guests exceed tickets")).not.toBeInTheDocument();
  });
});

describe("AttendeeRow - actions", () => {
  it("clicking the Edit button calls onEdit with the attendee", async () => {
    const user = userEvent.setup();
    const { attendee, onEdit } = renderRow();

    await user.click(screen.getByRole("button", { name: `Edit ${attendee.firstName} ${attendee.lastName}` }));

    expect(onEdit).toHaveBeenCalledWith(attendee);
  });

  it("clicking the Delete button calls onDeleteRequest with the attendee", async () => {
    const user = userEvent.setup();
    const { attendee, onDeleteRequest } = renderRow();

    await user.click(screen.getByRole("button", { name: `Delete ${attendee.firstName} ${attendee.lastName}` }));

    expect(onDeleteRequest).toHaveBeenCalledWith(attendee);
  });

  it("clicking the Pending pill calls onUpdatePaymentStatus with Paid", async () => {
    const user = userEvent.setup();
    const { attendee, onUpdatePaymentStatus } = renderRow({ attendee: makeAttendee({ paymentStatus: "Pending" }) });

    await user.click(screen.getByRole("button", { name: /pending/i }));

    expect(onUpdatePaymentStatus).toHaveBeenCalledWith(attendee, "Paid");
  });

  it("clicking the Paid pill calls onUpdatePaymentStatus with Pending", async () => {
    const user = userEvent.setup();
    const { attendee, onUpdatePaymentStatus } = renderRow({ attendee: makeAttendee({ paymentStatus: "Paid" }) });

    await user.click(screen.getByRole("button", { name: /paid/i }));

    expect(onUpdatePaymentStatus).toHaveBeenCalledWith(attendee, "Pending");
  });

  it("hides only the Delete button for someone who may not delete attendees (a User)", () => {
    const { attendee } = renderRow({ canDelete: false });

    expect(screen.getByRole("button", { name: `Edit ${attendee.firstName} ${attendee.lastName}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Delete ${attendee.firstName} ${attendee.lastName}` })).not.toBeInTheDocument();
  });

  it("hides the Edit and Delete buttons when the auction is closed", () => {
    const attendee = makeAttendee();
    render(
      <AttendeeRow
        attendee={attendee}
        isAuctionClosed={true}
        canDelete={true}
        onEdit={vi.fn()}
        onUpdatePaymentStatus={vi.fn()}
        onDeleteRequest={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: `Edit ${attendee.firstName} ${attendee.lastName}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Delete ${attendee.firstName} ${attendee.lastName}` })).not.toBeInTheDocument();
  });

  it("disables the payment pill when the auction is closed", () => {
    const attendee = makeAttendee({ paymentStatus: "Pending" });
    render(
      <AttendeeRow
        attendee={attendee}
        isAuctionClosed={true}
        canDelete={true}
        onEdit={vi.fn()}
        onUpdatePaymentStatus={vi.fn()}
        onDeleteRequest={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /pending/i })).toBeDisabled();
  });
});
