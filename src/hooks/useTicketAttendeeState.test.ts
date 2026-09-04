/**
 * @vitest-environment jsdom
 *
 * useTicketAttendeeState is only ever consumed through
 * TicketAttendeeTab.tsx, and TicketAttendeeTab.test.tsx mocks
 * useAttendeesData wholesale - so none of this hook's own updateField/
 * updatePaymentStatus logic has ever run under the test suite. Scoped
 * narrowly to their rollback behavior here (the same whole-snapshot
 * rollback bug already fixed in useWinnersData.ts, useAttendeesData.ts,
 * useAuctionItemsTableState.ts, useBiddersData.ts, and
 * useCheckoutState.ts this session) - the add/delete flows and search/
 * filter are a separate, larger test-coverage gap, not part of this fix.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTicketAttendeeState } from "./useTicketAttendeeState";
import { Attendee, Guest } from "@/types";

vi.mock("@/services/google-api", () => ({
  updateSheetData: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { updateSheetData } from "@/services/google-api";

const mockedUpdateSheetData = vi.mocked(updateSheetData);

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

describe("useTicketAttendeeState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateField", () => {
    it("rolls back the optimistic update on a failed sync", async () => {
      mockedUpdateSheetData.mockRejectedValue(new Error("sync failed"));

      let attendees = [makeAttendee({ id: "a1", firstName: "Alice" })];
      const setAttendees = vi.fn((updater: any) => {
        attendees = typeof updater === "function" ? updater(attendees) : updater;
      });

      const { result, rerender } = renderHook(
        (props: { attendees: Attendee[] }) =>
          useTicketAttendeeState({
            attendees: props.attendees,
            setAttendees,
            addAttendee: vi.fn(),
            removeAttendee: vi.fn(),
            spreadsheetId: "ss-id",
          }),
        { initialProps: { attendees } }
      );

      await act(async () => {
        await result.current.updateField(attendees[0], "firstName", "Alicia");
      });
      rerender({ attendees });

      await waitFor(() => expect(attendees[0].firstName).toBe("Alice"));
    });

    it("scopes a failed rollback to just the one attendee - a second attendee's already-committed edit must survive", async () => {
      let rejectFirst: (e: any) => void;
      let resolveSecond: (v: any) => void;
      mockedUpdateSheetData
        .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject; }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

      let attendees = [
        makeAttendee({ id: "a1", firstName: "Alice", rowIndex: 2 }),
        makeAttendee({ id: "a2", firstName: "Bob", rowIndex: 3 }),
      ];
      const setAttendees = vi.fn((updater: any) => {
        attendees = typeof updater === "function" ? updater(attendees) : updater;
      });

      const { result, rerender } = renderHook(
        (props: { attendees: Attendee[] }) =>
          useTicketAttendeeState({
            attendees: props.attendees,
            setAttendees,
            addAttendee: vi.fn(),
            removeAttendee: vi.fn(),
            spreadsheetId: "ss-id",
          }),
        { initialProps: { attendees } }
      );

      // Alice's edit starts first (her rollback snapshot is captured
      // before Bob has been touched at all) but her sync is the one that
      // ultimately fails.
      let aliceCall: Promise<void>;
      act(() => {
        aliceCall = result.current.updateField(attendees[0], "firstName", "Alicia");
      });
      rerender({ attendees });

      // Bob's edit starts second and succeeds while Alice's is still in
      // flight.
      let bobCall: Promise<void>;
      act(() => {
        bobCall = result.current.updateField(attendees[1], "firstName", "Bobby");
      });
      rerender({ attendees });

      expect(attendees[0].firstName).toBe("Alicia");
      expect(attendees[1].firstName).toBe("Bobby");

      // Bob's sync succeeds and commits first.
      await act(async () => {
        resolveSecond!(undefined);
        await bobCall;
      });
      rerender({ attendees });
      expect(attendees[1].firstName).toBe("Bobby");

      // Alice's sync fails after Bob already committed - her rollback
      // must not touch Bob.
      await act(async () => {
        rejectFirst!(new Error("network down"));
        await aliceCall.catch(() => {});
      });
      rerender({ attendees });

      await waitFor(() => expect(attendees[0].firstName).toBe("Alice"));
      expect(attendees[1].firstName).toBe("Bobby");
    });
  });

  describe("updateField - guest firstName/lastName/email column mapping", () => {
    // User-reported bug: "I was expecting to be able to edit the first and
    // last names of guests in the auction tickets table, like you can for
    // the primary bidder, but you can't." AttendeeRow.tsx only ever wired
    // up guest *email* edits; guest firstName/lastName weren't editable at
    // all, and updateField had no column mapping for them - only the
    // primary attendee's A/B columns and the pre-existing guest *email*
    // mapping. Column values here are cross-checked against
    // attendeeParsing.ts's own column layout (the inverse of what that
    // parser reads) and against the pre-existing guest-email columns this
    // test file already implicitly trusted.
    function setup(attendees: Attendee[]) {
      let current = attendees;
      const setAttendees = vi.fn((updater: any) => {
        current = typeof updater === "function" ? updater(current) : updater;
      });
      const hook = renderHook(
        (props: { attendees: Attendee[] }) =>
          useTicketAttendeeState({
            attendees: props.attendees,
            setAttendees,
            addAttendee: vi.fn(),
            removeAttendee: vi.fn(),
            spreadsheetId: "ss-id",
          }),
        { initialProps: { attendees } }
      );
      return { ...hook, getAttendees: () => current };
    }

    it("still maps the primary attendee's own firstName/lastName/email/phone to columns A/B/C/D (unaffected by the guest-column addition)", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const attendee = makeAttendee({ rowIndex: 5 });
      const { result } = setup([attendee]);

      await act(async () => { await result.current.updateField(attendee, "firstName", "Alicia"); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", "tickets!A5", [["Alicia"]]);

      await act(async () => { await result.current.updateField(attendee, "lastName", "Uno"); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", "tickets!B5", [["Uno"]]);

      await act(async () => { await result.current.updateField(attendee, "email", "new@example.com"); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", "tickets!C5", [["new@example.com"]]);

      await act(async () => { await result.current.updateField(attendee, "phone", "555-9999"); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", "tickets!D5", [["555-9999"]]);
    });

    it.each([
      [1, "H", "I", "J"],
      [2, "L", "M", "N"],
      [3, "P", "Q", "R"],
    ])("maps guest %i's firstName/lastName/email to the SHIFTED columns %s/%s/%s on the general 'tickets' sheet", async (guestIndex, firstCol, lastCol, emailCol) => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const guest = makeGuest({ guestIndex });
      const attendee = makeAttendee({ sheet: "tickets", rowIndex: 7, guestsInfo: [guest] });
      const { result } = setup([attendee]);

      await act(async () => { await result.current.updateField(attendee, "firstName", "Newfirst", guestIndex); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", `tickets!${firstCol}7`, [["Newfirst"]]);

      await act(async () => { await result.current.updateField(attendee, "lastName", "Newlast", guestIndex); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", `tickets!${lastCol}7`, [["Newlast"]]);

      await act(async () => { await result.current.updateField(attendee, "email", "new-guest@example.com", guestIndex); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", `tickets!${emailCol}7`, [["new-guest@example.com"]]);
    });

    it.each([
      [1, "H", "I", "J"],
      [2, "K", "L", "M"],
      [3, "N", "O", "P"],
    ])("maps guest %i's firstName/lastName/email to the UNSHIFTED columns %s/%s/%s on staff/sponsor sheets", async (guestIndex, firstCol, lastCol, emailCol) => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const guest = makeGuest({ guestIndex });
      const attendee = makeAttendee({ sheet: "sponsor tickets", rowIndex: 9, guestsInfo: [guest] });
      const { result } = setup([attendee]);

      await act(async () => { await result.current.updateField(attendee, "firstName", "Newfirst", guestIndex); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", `sponsor tickets!${firstCol}9`, [["Newfirst"]]);

      await act(async () => { await result.current.updateField(attendee, "lastName", "Newlast", guestIndex); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", `sponsor tickets!${lastCol}9`, [["Newlast"]]);

      await act(async () => { await result.current.updateField(attendee, "email", "new-guest@example.com", guestIndex); });
      expect(mockedUpdateSheetData).toHaveBeenLastCalledWith("ss-id", `sponsor tickets!${emailCol}9`, [["new-guest@example.com"]]);
    });

    it("updates only the touched guest's own field in local state, not a different field on that guest - the exact regression this fix closes", async () => {
      // Before this fix, the optimistic update always wrote to the guest's
      // `email` key regardless of which field was actually being edited,
      // so a firstName edit for a guest would (once guest firstName editing
      // existed at all) have silently landed in the wrong local field.
      mockedUpdateSheetData.mockImplementation(() => new Promise(() => {})); // never resolves - inspect the optimistic state directly
      const guest = makeGuest({ guestIndex: 1, firstName: "Bob", lastName: "Guest", email: "bob@example.com" });
      const attendee = makeAttendee({ guestsInfo: [guest] });
      const { result, getAttendees } = setup([attendee]);

      act(() => { result.current.updateField(attendee, "firstName", "Robert", 1); });

      const updatedGuest = getAttendees()[0].guestsInfo[0];
      expect(updatedGuest.firstName).toBe("Robert");
      expect(updatedGuest.email).toBe("bob@example.com"); // untouched
      expect(updatedGuest.lastName).toBe("Guest"); // untouched
    });

    it("keeps the guest's combined display name (name) in sync when firstName/lastName is edited", async () => {
      mockedUpdateSheetData.mockImplementation(() => new Promise(() => {}));
      const guest = makeGuest({ guestIndex: 1, firstName: "Bob", lastName: "Guest", name: "Bob Guest" });
      const attendee = makeAttendee({ guestsInfo: [guest] });
      const { result, getAttendees } = setup([attendee]);

      act(() => { result.current.updateField(attendee, "firstName", "Robert", 1); });

      expect(getAttendees()[0].guestsInfo[0].name).toBe("Robert Guest");
    });

    it("only touches the edited guest, leaving a second guest on the same attendee untouched", async () => {
      mockedUpdateSheetData.mockImplementation(() => new Promise(() => {}));
      const guest1 = makeGuest({ guestIndex: 1, firstName: "Bob", lastName: "Guest1" });
      const guest2 = makeGuest({ guestIndex: 2, firstName: "Carol", lastName: "Guest2" });
      const attendee = makeAttendee({ guestsInfo: [guest1, guest2] });
      const { result, getAttendees } = setup([attendee]);

      act(() => { result.current.updateField(attendee, "firstName", "Robert", 1); });

      const [updatedGuest1, untouchedGuest2] = getAttendees()[0].guestsInfo;
      expect(updatedGuest1.firstName).toBe("Robert");
      expect(untouchedGuest2.firstName).toBe("Carol");
    });
  });

  describe("updatePaymentStatus", () => {
    it("rolls back the optimistic update on a failed sync", async () => {
      mockedUpdateSheetData.mockRejectedValue(new Error("sync failed"));

      let attendees = [makeAttendee({ id: "a1", paymentStatus: "Pending" })];
      const setAttendees = vi.fn((updater: any) => {
        attendees = typeof updater === "function" ? updater(attendees) : updater;
      });

      const { result, rerender } = renderHook(
        (props: { attendees: Attendee[] }) =>
          useTicketAttendeeState({
            attendees: props.attendees,
            setAttendees,
            addAttendee: vi.fn(),
            removeAttendee: vi.fn(),
            spreadsheetId: "ss-id",
          }),
        { initialProps: { attendees } }
      );

      await act(async () => {
        await result.current.updatePaymentStatus(attendees[0], "Paid");
      });
      rerender({ attendees });

      await waitFor(() => expect(attendees[0].paymentStatus).toBe("Pending"));
    });

    it("scopes a failed rollback to just the one attendee - a second attendee's already-committed status must survive", async () => {
      let rejectFirst: (e: any) => void;
      let resolveSecond: (v: any) => void;
      mockedUpdateSheetData
        .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject; }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

      let attendees = [
        makeAttendee({ id: "a1", paymentStatus: "Pending", rowIndex: 2 }),
        makeAttendee({ id: "a2", paymentStatus: "Pending", rowIndex: 3 }),
      ];
      const setAttendees = vi.fn((updater: any) => {
        attendees = typeof updater === "function" ? updater(attendees) : updater;
      });

      const { result, rerender } = renderHook(
        (props: { attendees: Attendee[] }) =>
          useTicketAttendeeState({
            attendees: props.attendees,
            setAttendees,
            addAttendee: vi.fn(),
            removeAttendee: vi.fn(),
            spreadsheetId: "ss-id",
          }),
        { initialProps: { attendees } }
      );

      let aliceCall: Promise<void>;
      act(() => {
        aliceCall = result.current.updatePaymentStatus(attendees[0], "Paid");
      });
      rerender({ attendees });

      let bobCall: Promise<void>;
      act(() => {
        bobCall = result.current.updatePaymentStatus(attendees[1], "Paid");
      });
      rerender({ attendees });

      expect(attendees[0].paymentStatus).toBe("Paid");
      expect(attendees[1].paymentStatus).toBe("Paid");

      // Bob's sync succeeds and commits first.
      await act(async () => {
        resolveSecond!(undefined);
        await bobCall;
      });
      rerender({ attendees });
      expect(attendees[1].paymentStatus).toBe("Paid");

      // Alice's sync fails after Bob already committed - her rollback
      // must not touch Bob.
      await act(async () => {
        rejectFirst!(new Error("network down"));
        await aliceCall.catch(() => {});
      });
      rerender({ attendees });

      await waitFor(() => expect(attendees[0].paymentStatus).toBe("Pending"));
      expect(attendees[1].paymentStatus).toBe("Paid");
    });
  });

  describe("handleEditSave", () => {
    // EditAttendeeDialog.tsx collects every field (contact, guests,
    // payment status) into one draft and Save calls this once - it
    // must diff against the attendee actually being edited and only
    // sync the fields that changed, reusing updateField/
    // updatePaymentStatus's own already-tested column mapping and
    // rollback behavior rather than re-syncing everything unconditionally.
    function setup(attendees: Attendee[]) {
      let current = attendees;
      const setAttendees = vi.fn((updater: any) => {
        current = typeof updater === "function" ? updater(current) : updater;
      });
      const hook = renderHook(
        (props: { attendees: Attendee[] }) =>
          useTicketAttendeeState({
            attendees: props.attendees,
            setAttendees,
            addAttendee: vi.fn(),
            removeAttendee: vi.fn(),
            spreadsheetId: "ss-id",
          }),
        { initialProps: { attendees } }
      );
      return { ...hook, getAttendees: () => current };
    }

    it("does nothing until an attendee is being edited", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const { result } = setup([makeAttendee()]);

      await act(async () => {
        await result.current.handleEditSave({ firstName: "X", lastName: "Y", email: "z@e.com", phone: "1", paymentStatus: "Paid", guests: [] });
      });

      expect(mockedUpdateSheetData).not.toHaveBeenCalled();
    });

    it("only syncs the contact fields that actually changed", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const attendee = makeAttendee({ rowIndex: 5, firstName: "Alice", lastName: "One", email: "alice@example.com", phone: "555-0100" });
      const { result } = setup([attendee]);

      act(() => { result.current.setAttendeeToEdit(attendee); });

      await act(async () => {
        await result.current.handleEditSave({
          firstName: "Alicia", // changed
          lastName: "One",     // unchanged
          email: "alice@example.com", // unchanged
          phone: "555-0100",   // unchanged
          paymentStatus: attendee.paymentStatus, // unchanged
          guests: [],
        });
      });

      expect(mockedUpdateSheetData).toHaveBeenCalledTimes(1);
      expect(mockedUpdateSheetData).toHaveBeenCalledWith("ss-id", "tickets!A5", [["Alicia"]]);
    });

    it("syncs a changed guest field using the guest's own column mapping", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const guest = makeGuest({ guestIndex: 1, firstName: "Bob", lastName: "Guest", email: "bob@example.com" });
      const attendee = makeAttendee({ rowIndex: 7, guestsInfo: [guest] });
      const { result } = setup([attendee]);

      act(() => { result.current.setAttendeeToEdit(attendee); });

      await act(async () => {
        await result.current.handleEditSave({
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          email: attendee.email,
          phone: attendee.phone,
          paymentStatus: attendee.paymentStatus,
          guests: [{ guestIndex: 1, firstName: "Robert", lastName: "Guest", email: "bob@example.com" }],
        });
      });

      expect(mockedUpdateSheetData).toHaveBeenCalledTimes(1);
      expect(mockedUpdateSheetData).toHaveBeenCalledWith("ss-id", "tickets!H7", [["Robert"]]);
    });

    it("syncs a changed payment status via updatePaymentStatus's own column", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const attendee = makeAttendee({ rowIndex: 5, sheet: "tickets", paymentStatus: "Pending" });
      const { result } = setup([attendee]);

      act(() => { result.current.setAttendeeToEdit(attendee); });

      await act(async () => {
        await result.current.handleEditSave({
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          email: attendee.email,
          phone: attendee.phone,
          paymentStatus: "Paid",
          guests: [],
        });
      });

      expect(mockedUpdateSheetData).toHaveBeenCalledTimes(1);
      expect(mockedUpdateSheetData).toHaveBeenCalledWith("ss-id", "tickets!U5", [["Paid"]]);
    });

    it("closes the edit dialog (clears attendeeToEdit) after a save with no changes", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const attendee = makeAttendee();
      const { result } = setup([attendee]);

      act(() => { result.current.setAttendeeToEdit(attendee); });
      expect(result.current.attendeeToEdit).toBe(attendee);

      await act(async () => {
        await result.current.handleEditSave({
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          email: attendee.email,
          phone: attendee.phone,
          paymentStatus: attendee.paymentStatus,
          guests: [],
        });
      });

      expect(mockedUpdateSheetData).not.toHaveBeenCalled();
      expect(result.current.attendeeToEdit).toBeNull();
    });

    it("closes the edit dialog after a save that does sync changes", async () => {
      mockedUpdateSheetData.mockResolvedValue(undefined);
      const attendee = makeAttendee({ firstName: "Alice" });
      const { result } = setup([attendee]);

      act(() => { result.current.setAttendeeToEdit(attendee); });

      await act(async () => {
        await result.current.handleEditSave({
          firstName: "Alicia",
          lastName: attendee.lastName,
          email: attendee.email,
          phone: attendee.phone,
          paymentStatus: attendee.paymentStatus,
          guests: [],
        });
      });

      expect(result.current.attendeeToEdit).toBeNull();
    });
  });
});
