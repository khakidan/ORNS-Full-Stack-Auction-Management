/**
 * @vitest-environment jsdom
 *
 * component-standards.md documents that SelectValue with no children
 * renders the raw stored value, not the matching SelectItem's label -
 * this component's Source filter select had exactly that gap (logged in
 * CHANGELOG.md after being found while confirming the
 * sibling AddAttendeeDialog.tsx/BiddersFilterControls.tsx bug). The
 * main TicketAttendeeTab.test.tsx mocks @/components/ui/select
 * wholesale (as a native <select>, for reliable userEvent testing of
 * the filtering logic itself), so it could never have caught this - the
 * real @base-ui/react Select is deliberately left unmocked here, with
 * everything else needed to render the component mocked out instead.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TicketAttendeeTab from "./TicketAttendeeTab";

vi.mock("motion/react", () => ({
  motion: new Proxy({}, {
    get: (_target, tag) =>
      ({ children, ...props }: any) => {
        const { createElement } = require("react");
        return createElement(String(tag), props, children);
      }
  }),
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/AttendeesTable", () => ({
  AttendeesTable: () => <div data-testid="mock-attendees-table" />,
}));

vi.mock("@/components/AddAttendeeDialog", () => ({
  AddAttendeeDialog: () => <div data-testid="mock-add-attendee-dialog" />,
}));

vi.mock("@/components/ui/ConfirmationDialog", () => ({
  ConfirmationDialog: () => null,
}));

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getSheetData: vi.fn(() => Promise.resolve({ values: [] })),
  updateSheetData: vi.fn(() => Promise.resolve({ success: true })),
  appendSheetData: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: { auctionTicketsSpreadsheetId: "test-tickets-spreadsheet-id" } }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ can: () => true }),
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    attendees: [],
    addAttendee: vi.fn(),
    setAttendees: vi.fn(),
    loading: false,
    attendeesLoading: false,
    removeAttendee: vi.fn(),
    fetchAttendees: vi.fn(),
    isAuctionClosed: false,
  }),
}));

describe("TicketAttendeeTab - Source filter display label", () => {
  it("shows the friendly 'All Sources' label by default, not the raw stored value", () => {
    render(<TicketAttendeeTab />);

    expect(screen.getByText("All Sources")).toBeInTheDocument();
    expect(screen.queryByText("all")).not.toBeInTheDocument();
  });
});
