/**
 * @vitest-environment jsdom
 *
 * Dedicated unit coverage for the shared guest editor (previously only
 * exercised indirectly through AddAttendeeDialog.test.tsx/
 * EditAttendeeDialog.test.tsx, which never drove it up to its 3-guest
 * cap - see docs/agents/refactor-opportunities.md's 2026-09-07 audit).
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AttendeeGuestsEditor, GuestDraft, MAX_GUESTS, makeGuestDraft } from "./AttendeeGuestsEditor";

function makeGuest(overrides: Partial<GuestDraft> = {}): GuestDraft {
  return { guestIndex: 1, name: "", firstName: "", lastName: "", email: "", ownBidderNumber: "", ...overrides };
}

describe("AttendeeGuestsEditor - MAX_GUESTS boundary", () => {
  it("is 3, matching the ticket sheet's fixed 3-guest-column layout", () => {
    expect(MAX_GUESTS).toBe(3);
  });

  it("shows Add Guest when fewer than 3 guests exist", () => {
    render(
      <AttendeeGuestsEditor
        guests={[makeGuest({ guestIndex: 1 }), makeGuest({ guestIndex: 2 })]}
        onChange={vi.fn()}
        allowOwnBidderNumber={false}
      />
    );

    expect(screen.getByRole("button", { name: /add guest/i })).toBeInTheDocument();
  });

  it("hides Add Guest once all 3 slots are filled", () => {
    render(
      <AttendeeGuestsEditor
        guests={[makeGuest({ guestIndex: 1 }), makeGuest({ guestIndex: 2 }), makeGuest({ guestIndex: 3 })]}
        onChange={vi.fn()}
        allowOwnBidderNumber={false}
      />
    );

    expect(screen.queryByRole("button", { name: /add guest/i })).not.toBeInTheDocument();
  });

  it("clicking Add Guest at 2 guests appends the 3rd slot, not a 4th", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AttendeeGuestsEditor
        guests={[makeGuest({ guestIndex: 1 }), makeGuest({ guestIndex: 2 })]}
        onChange={onChange}
        allowOwnBidderNumber={false}
      />
    );

    await user.click(screen.getByRole("button", { name: /add guest/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ guestIndex: 1 }),
      expect.objectContaining({ guestIndex: 2 }),
      expect.objectContaining({ guestIndex: 3 }),
    ]);
  });

  it("fills the lowest empty slot, not always the next sequential one, when there's a gap", async () => {
    // guestIndex 2 present, 1 and 3 empty - addGuest should pick 1, the
    // lowest missing slot, not 3.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AttendeeGuestsEditor
        guests={[makeGuest({ guestIndex: 2 })]}
        onChange={onChange}
        allowOwnBidderNumber={false}
      />
    );

    await user.click(screen.getByRole("button", { name: /add guest/i }));

    const result = onChange.mock.calls[0][0] as GuestDraft[];
    expect(result.map((g) => g.guestIndex)).toEqual([1, 2]);
  });
});

describe("AttendeeGuestsEditor - own-bidder-number visibility", () => {
  it("shows the checkbox when allowOwnBidderNumber is true", () => {
    render(
      <AttendeeGuestsEditor guests={[makeGuest()]} onChange={vi.fn()} allowOwnBidderNumber={true} />
    );
    expect(screen.getByText("Wants their own bidder number")).toBeInTheDocument();
  });

  it("hides the checkbox when allowOwnBidderNumber is false", () => {
    render(
      <AttendeeGuestsEditor guests={[makeGuest()]} onChange={vi.fn()} allowOwnBidderNumber={false} />
    );
    expect(screen.queryByText("Wants their own bidder number")).not.toBeInTheDocument();
  });
});

describe("AttendeeGuestsEditor - editing and removing", () => {
  it("editing a guest's first name keeps other fields and re-derives the combined name", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AttendeeGuestsEditor
        guests={[makeGuest({ guestIndex: 1, firstName: "Bob", lastName: "Guest", email: "bob@example.com" })]}
        onChange={onChange}
        allowOwnBidderNumber={false}
      />
    );

    await user.type(screen.getByPlaceholderText("First"), "!");

    const result = onChange.mock.calls[0][0] as GuestDraft[];
    expect(result[0]).toMatchObject({ firstName: "Bob!", lastName: "Guest", email: "bob@example.com", name: "Bob! Guest" });
  });

  it("removing a guest excludes it and leaves the others untouched", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AttendeeGuestsEditor
        guests={[makeGuest({ guestIndex: 1, firstName: "A" }), makeGuest({ guestIndex: 2, firstName: "B" })]}
        onChange={onChange}
        allowOwnBidderNumber={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove guest 1" }));

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ guestIndex: 2, firstName: "B" })]);
  });

  it("shows the 'No guests' message only when the list is empty", () => {
    render(<AttendeeGuestsEditor guests={[]} onChange={vi.fn()} allowOwnBidderNumber={false} />);
    expect(screen.getByText("No guests on this entry.")).toBeInTheDocument();
  });
});

describe("makeGuestDraft", () => {
  it("creates a blank guest at the given slot", () => {
    expect(makeGuestDraft(2)).toEqual({ guestIndex: 2, name: "", firstName: "", lastName: "", email: "", ownBidderNumber: "" });
  });
});
