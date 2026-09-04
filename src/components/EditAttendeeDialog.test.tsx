/**
 * @vitest-environment jsdom
 *
 * EditAttendeeDialog.tsx is the replacement editing surface introduced
 * for the "Attendee List UI Layout Issues" bug report - it replaces the
 * per-field inline editors that used to live directly in AttendeeRow.tsx
 * with a single dialog covering contact info, every guest, and payment
 * status at once. The real (unmocked) Dialog is rendered here, matching
 * AddAttendeeDialog.test.tsx's convention.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { EditAttendeeDialog } from "./EditAttendeeDialog";
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
    hasGuests: "",
    guestsInfo: [],
    paymentMethod: "Manual",
    paymentStatus: "Pending",
    totalPaid: "$0",
    ...overrides,
  };
}

function renderDialog(attendee: Attendee, overrides: Partial<Parameters<typeof EditAttendeeDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EditAttendeeDialog
      attendee={attendee}
      open={true}
      onOpenChange={onOpenChange}
      onSave={onSave}
      isSaving={false}
      {...overrides}
    />
  );
  return { onSave, onOpenChange };
}

describe("EditAttendeeDialog - prefill", () => {
  it("prefills the contact fields from the attendee", () => {
    renderDialog(makeAttendee({ firstName: "Alice", lastName: "One", email: "alice@example.com", phone: "555-0100" }));

    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByDisplayValue("One")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("555-0100")).toBeInTheDocument();
  });

  it("shows a card per guest with their own name and email prefilled", () => {
    renderDialog(makeAttendee({
      guestsInfo: [
        makeGuest({ guestIndex: 1, firstName: "Bob", lastName: "Guest", email: "bob@example.com" }),
        makeGuest({ guestIndex: 2, firstName: "Carol", lastName: "Guest2", email: "carol@example.com" }),
      ],
    }));

    expect(screen.getByText("Guest 1")).toBeInTheDocument();
    expect(screen.getByText("Guest 2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bob")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Carol")).toBeInTheDocument();
    expect(screen.getByDisplayValue("bob@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("carol@example.com")).toBeInTheDocument();
  });

  it("shows the own-bidder-number badge only for a guest who opted in", () => {
    renderDialog(makeAttendee({
      guestsInfo: [
        makeGuest({ guestIndex: 1, ownBidderNumber: "yes" }),
        makeGuest({ guestIndex: 2, firstName: "Carol", lastName: "Guest2", ownBidderNumber: "no" }),
      ],
    }));

    expect(screen.getAllByText("Own bidder #")).toHaveLength(1);
  });

  it("shows a message instead of a guest section when there are no guests", () => {
    renderDialog(makeAttendee({ guestsInfo: [] }));

    expect(screen.getByText("No guests on this entry.")).toBeInTheDocument();
  });

  it("re-prefills when switching to a different attendee", () => {
    const attendeeA = makeAttendee({ id: "a1", firstName: "Alice" });
    const { rerender } = render(
      <EditAttendeeDialog attendee={attendeeA} open={true} onOpenChange={() => {}} onSave={() => {}} isSaving={false} />
    );
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();

    const attendeeB = makeAttendee({ id: "a2", firstName: "Bob", lastName: "Two" });
    rerender(
      <EditAttendeeDialog attendee={attendeeB} open={true} onOpenChange={() => {}} onSave={() => {}} isSaving={false} />
    );
    expect(screen.getByDisplayValue("Bob")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alice")).not.toBeInTheDocument();
  });
});

describe("EditAttendeeDialog - editing and saving", () => {
  it("editing a field and clicking Save Changes calls onSave with the updated draft", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeAttendee({ firstName: "Alice" }));

    const firstNameInput = screen.getByDisplayValue("Alice");
    await user.clear(firstNameInput);
    await user.type(firstNameInput, "Alicia");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Alicia" }));
  });

  it("editing a guest field and saving includes it in the guests array of the draft", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeAttendee({
      guestsInfo: [makeGuest({ guestIndex: 1, firstName: "Bob" })],
    }));

    const guestFirstNameInput = screen.getByDisplayValue("Bob");
    await user.clear(guestFirstNameInput);
    await user.type(guestFirstNameInput, "Robert");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        guests: [expect.objectContaining({ guestIndex: 1, firstName: "Robert" })],
      })
    );
  });

  it("toggling the payment control to Paid includes it in the saved draft", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeAttendee({ paymentStatus: "Pending" }));

    await user.click(screen.getByRole("button", { name: "Paid" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "Paid" }));
  });

  it("clicking Cancel calls onOpenChange(false) without saving", async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = renderDialog(makeAttendee());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });
});
