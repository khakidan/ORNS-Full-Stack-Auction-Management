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
import { Attendee } from "@/types";

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
});
