/**
 * @vitest-environment jsdom
 *
 * component-standards.md documents that SelectValue with no children
 * renders the raw stored value, not the matching SelectItem's label -
 * this component's Source select had exactly that gap (flagged in
 * refactor-opportunities.md). Every other test touching this component
 * (TicketAttendeeTab.test.tsx) mocks @/components/ui/select wholesale,
 * so none of them could ever have caught this - the real @base-ui/react
 * Select is deliberately left unmocked here.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AddAttendeeDialog, NewAttendeeEntry } from "./AddAttendeeDialog";

function makeNewEntry(overrides: Partial<NewAttendeeEntry> = {}): NewAttendeeEntry {
  return { firstName: "", lastName: "", email: "", phone: "", source: "tickets", tickets: "1", guests: [], ...overrides };
}

function renderDialog(source: string) {
  return render(
    <AddAttendeeDialog
      open={true}
      onOpenChange={() => {}}
      newEntry={makeNewEntry({ source })}
      onNewEntryChange={() => {}}
      onSubmit={() => {}}
      isSubmitting={false}
    />
  );
}

function renderWithEntry(newEntry: NewAttendeeEntry, overrides: Partial<Parameters<typeof AddAttendeeDialog>[0]> = {}) {
  const onNewEntryChange = vi.fn();
  const onSubmit = vi.fn();
  const { unmount } = render(
    <AddAttendeeDialog
      open={true}
      onOpenChange={() => {}}
      newEntry={newEntry}
      onNewEntryChange={onNewEntryChange}
      onSubmit={onSubmit}
      isSubmitting={false}
      {...overrides}
    />
  );
  return { onNewEntryChange, onSubmit, unmount };
}

describe("AddAttendeeDialog - Source select display label", () => {
  it("shows the friendly label, not the raw stored value, for a non-default source", () => {
    renderDialog("sponsor tickets");

    expect(screen.getByText("Sponsor")).toBeInTheDocument();
    expect(screen.queryByText("sponsor tickets")).not.toBeInTheDocument();
  });

  it("shows the friendly label for the staff source", () => {
    renderDialog("staff tickets");

    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.queryByText("staff tickets")).not.toBeInTheDocument();
  });

  it("shows the friendly label for the default general-tickets source", () => {
    renderDialog("tickets");

    expect(screen.getByText("General Tickets")).toBeInTheDocument();
  });
});

describe("AddAttendeeDialog - guests", () => {
  it("starts with no guests and a visible Add Guest control", () => {
    renderWithEntry(makeNewEntry());

    expect(screen.getByText("No guests on this entry.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add guest/i })).toBeInTheDocument();
  });

  it("clicking Add Guest appends a guest slot via onNewEntryChange", async () => {
    const user = userEvent.setup();
    const { onNewEntryChange } = renderWithEntry(makeNewEntry());

    await user.click(screen.getByRole("button", { name: /add guest/i }));

    expect(onNewEntryChange).toHaveBeenCalledWith(
      expect.objectContaining({ guests: [expect.objectContaining({ guestIndex: 1 })] })
    );
  });

  it("shows the own-bidder-number checkbox for General Tickets guests but not Staff/Sponsor", () => {
    const guest = { guestIndex: 1 as const, name: "", firstName: "", lastName: "", email: "", ownBidderNumber: "" };

    const { unmount } = renderWithEntry(makeNewEntry({ source: "tickets", guests: [guest] }));
    expect(screen.getByText("Wants their own bidder number")).toBeInTheDocument();
    unmount();

    renderWithEntry(makeNewEntry({ source: "staff tickets", guests: [guest] }));
    expect(screen.queryByText("Wants their own bidder number")).not.toBeInTheDocument();
  });

  it("blocks Save when guests exceed tickets purchased, with an inline explanation", async () => {
    const guests = [
      { guestIndex: 1 as const, name: "", firstName: "A", lastName: "", email: "", ownBidderNumber: "" },
      { guestIndex: 2 as const, name: "", firstName: "B", lastName: "", email: "", ownBidderNumber: "" },
    ];
    const { onSubmit } = renderWithEntry(makeNewEntry({ tickets: "1", guests }));

    expect(screen.getByText(/guests listed but only 1 ticket/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Entry" })).toBeDisabled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Save Entry" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
