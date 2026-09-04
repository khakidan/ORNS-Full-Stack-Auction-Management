/**
 * @vitest-environment jsdom
 *
 * User-reported bug: "I was expecting to be able to edit the first and
 * last names of guests in the auction tickets table, like you can for the
 * primary bidder, but you can't." AttendeeRow.tsx used to render a guest's
 * name as a plain, non-editable <span> (just onUpdateField'ing the guest's
 * email) while the primary attendee's own firstName/lastName were already
 * real EditableCells - this pins that guest firstName/lastName are now
 * editable the same way, and that editing calls onUpdateField with the
 * real guestIndex so useTicketAttendeeState.ts's column mapping fires
 * correctly (covered directly in useTicketAttendeeState.test.ts; this
 * file only covers the component wiring itself).
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
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

function renderRow(attendee: Attendee, onUpdateField = vi.fn()) {
  render(
    <table>
      <tbody>
        <AttendeeRow
          attendee={attendee}
          isAuctionClosed={false}
          onUpdateField={onUpdateField}
          onUpdatePaymentStatus={vi.fn()}
          onDeleteRequest={vi.fn()}
        />
      </tbody>
    </table>
  );
  return onUpdateField;
}

/** Edits an EditableCell that's currently showing `currentValue` (via its read-mode title) to `newValue`. */
async function editCell(currentValue: string, newValue: string) {
  const user = userEvent.setup();
  const displayed = screen.getByTitle(currentValue);
  const editButton = within(displayed.parentElement!).getByRole("button", { name: "Edit" });
  await user.click(editButton);

  const input = screen.getByDisplayValue(currentValue);
  await user.clear(input);
  await user.type(input, newValue);
  await user.click(screen.getByRole("button", { name: /save/i }));
}

describe("AttendeeRow - guest firstName/lastName editing", () => {
  it("renders a guest's firstName and lastName as real, editable text (not a plain span)", () => {
    const attendee = makeAttendee({ guestsInfo: [makeGuest({ firstName: "Bob", lastName: "Guest" })] });
    renderRow(attendee);

    expect(screen.getByTitle("Bob")).toBeInTheDocument();
    expect(screen.getByTitle("Guest")).toBeInTheDocument();
  });

  it("editing a guest's firstName calls onUpdateField with the field, new value, and the guest's own guestIndex", async () => {
    const attendee = makeAttendee({ guestsInfo: [makeGuest({ guestIndex: 2, firstName: "Bob", lastName: "Guest" })] });
    const onUpdateField = renderRow(attendee);

    await editCell("Bob", "Robert");

    expect(onUpdateField).toHaveBeenCalledWith(attendee, "firstName", "Robert", 2);
  });

  it("editing a guest's lastName calls onUpdateField with the field, new value, and the guest's own guestIndex", async () => {
    const attendee = makeAttendee({ guestsInfo: [makeGuest({ guestIndex: 2, firstName: "Bob", lastName: "Guest" })] });
    const onUpdateField = renderRow(attendee);

    await editCell("Guest", "Guestson");

    expect(onUpdateField).toHaveBeenCalledWith(attendee, "lastName", "Guestson", 2);
  });

  it("still lets the primary attendee's own firstName/lastName be edited (guestIndex undefined) - unaffected by the guest-editing addition", async () => {
    const attendee = makeAttendee({ firstName: "Alice", lastName: "One" });
    const onUpdateField = renderRow(attendee);

    await editCell("Alice", "Alicia");

    expect(onUpdateField).toHaveBeenCalledWith(attendee, "firstName", "Alicia");
  });

  it("still renders and updates a guest's email correctly, unaffected by the firstName/lastName addition", async () => {
    const attendee = makeAttendee({ guestsInfo: [makeGuest({ guestIndex: 1, email: "bob@example.com" })] });
    const onUpdateField = renderRow(attendee);

    await editCell("bob@example.com", "bob-new@example.com");

    expect(onUpdateField).toHaveBeenCalledWith(attendee, "email", "bob-new@example.com", 1);
  });

  it("shows the 'Own #' badge next to a guest's name fields when they opted in, keyed off ownBidderNumber", () => {
    const attendee = makeAttendee({
      guestsInfo: [makeGuest({ ownBidderNumber: "yes" }), makeGuest({ guestIndex: 2, firstName: "Carol", lastName: "Guest2", ownBidderNumber: "no" })],
    });
    renderRow(attendee);

    expect(screen.getAllByText("Own #")).toHaveLength(1);
  });
});
