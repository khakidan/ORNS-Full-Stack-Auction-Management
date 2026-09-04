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
import { describe, it, expect } from "vitest";
import { AddAttendeeDialog } from "./AddAttendeeDialog";

function renderDialog(source: string) {
  return render(
    <AddAttendeeDialog
      open={true}
      onOpenChange={() => {}}
      newEntry={{ firstName: "", lastName: "", email: "", phone: "", source, tickets: "" }}
      onNewEntryChange={() => {}}
      onSubmit={() => {}}
      isSubmitting={false}
    />
  );
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
