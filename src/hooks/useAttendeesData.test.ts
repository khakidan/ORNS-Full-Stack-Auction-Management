/**
 * @vitest-environment jsdom
 *
 * useAttendeesData is only ever consumed through TicketAttendeeTab.tsx
 * (via useTicketAttendeeState.ts), and TicketAttendeeTab.test.tsx mocks
 * it wholesale - so none of its real logic has ever run under the test
 * suite. Tested directly via renderHook, matching the pattern already
 * established for useBiddersData.ts/useWinnersData.ts.
 *
 * addAttendee/removeAttendee had the exact "whole stale snapshot"
 * rollback bug already found and fixed in useWinnersData.ts's
 * recordWinningBid: both captured `previousAttendees` from the render
 * closure and restored it absolutely on failure, so two adds/removes
 * triggered in quick succession (before either re-renders) both capture
 * the same baseline - if the second fails, its rollback erases the
 * first's already-committed change too. Fixed to scope each rollback to
 * just the one entry it touched. Also fixed a related latent bug found
 * while writing these tests: `tempId = \`temp-${Date.now()}\`` alone
 * could collide for two adds triggered in the same millisecond, which
 * would have made a scoped rollback affect both new entries instead of
 * just the failed one - now includes a random suffix too.
 *
 * Also added a real `loading` state (CHANGELOG.md): this
 * hook previously tracked no loading state of its own at all -
 * TicketAttendeeTab.tsx's Refresh button and table spinner were wired to
 * useBiddersData.ts's `loading` from context instead, so they never
 * actually reflected this hook's own fetch.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAttendeesData } from "./useAttendeesData";
import { Attendee } from "@/types";

vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(),
  appendAttendeeRow: vi.fn(),
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
  errorTextFrom: (data: any, fallback: string) => data?.error || fallback,
}));

vi.mock("@/services/apiClient", () => ({ postJson: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSheetData, appendAttendeeRow, fetchWithRetry } from "@/services/google-api";
import { postJson } from "@/services/apiClient";
import { toast } from "sonner";

const mockedGetSheetData = vi.mocked(getSheetData);
const mockedAppendSheetData = vi.mocked(appendAttendeeRow);
const mockedDeleteAttendee = vi.mocked(postJson);

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

const TICKETS_ROWS = [
  ["Header"],
  ["Alice", "One", "alice@example.com", "555-0100", "1", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Manual", "Pending", "$0"],
];

describe("useAttendeesData.fetchAttendees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when ticketsSpreadsheetId is empty", async () => {
    const { result } = renderHook(() => useAttendeesData(""));
    await act(async () => {
      await result.current.fetchAttendees();
    });

    expect(getSheetData).not.toHaveBeenCalled();
    expect(result.current.attendees).toEqual([]);
  });

  it("fetches and combines all three attendee sheets", async () => {
    mockedGetSheetData.mockImplementation((_id: string, range: string) => {
      if (range.startsWith("tickets")) return Promise.resolve({ values: TICKETS_ROWS });
      if (range.startsWith("staff tickets")) return Promise.resolve({ values: [["Header"], ["Staff", "Member", "staff@example.com"]] });
      if (range.startsWith("sponsor tickets")) return Promise.resolve({ values: [["Header"]] }); // header-only, no rows
      return Promise.resolve({ values: [] });
    });

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    await act(async () => {
      await result.current.fetchAttendees();
    });

    expect(result.current.attendees).toHaveLength(2);
    expect(result.current.attendees.map(a => a.firstName)).toEqual(["Alice", "Staff"]);
  });

  it("swallows one sheet's fetch failure and still returns the others", async () => {
    mockedGetSheetData.mockImplementation((_id: string, range: string) => {
      if (range.startsWith("tickets")) return Promise.resolve({ values: TICKETS_ROWS });
      return Promise.reject(new Error("network down"));
    });

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    await act(async () => {
      await result.current.fetchAttendees();
    });

    expect(result.current.attendees).toHaveLength(1);
    expect(result.current.attendees[0].firstName).toBe("Alice");
  });

  it("tracks its own loading state - true while the fetch is in flight, false once it settles", async () => {
    // TicketAttendeeTab.tsx used to have no attendees-specific loading
    // flag at all and borrowed useBiddersData.ts's `loading` instead, so
    // its Refresh button/table spinner never actually reflected this
    // fetch. Regression guard for that fix: this hook must expose and
    // maintain its own `loading`.
    let resolveFirstSheet: (v: any) => void;
    mockedGetSheetData.mockImplementation((_id: string, range: string) => {
      if (range.startsWith("tickets")) {
        return new Promise((resolve) => { resolveFirstSheet = resolve; });
      }
      return Promise.resolve({ values: [] });
    });

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    expect(result.current.loading).toBe(false);

    let fetchPromise: Promise<void>;
    act(() => {
      fetchPromise = result.current.fetchAttendees();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolveFirstSheet!({ values: TICKETS_ROWS });
      await fetchPromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it("does not set loading when ticketsSpreadsheetId is empty - fetchAttendees returns before the guard", async () => {
    const { result } = renderHook(() => useAttendeesData(""));
    await act(async () => {
      await result.current.fetchAttendees();
    });

    expect(result.current.loading).toBe(false);
  });
});

describe("useAttendeesData.addAttendee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSheetData.mockResolvedValue({ values: [] });
  });

  it("does nothing when ticketsSpreadsheetId is empty", async () => {
    const { result } = renderHook(() => useAttendeesData(""));
    await act(async () => {
      await result.current.addAttendee("tickets", ["Alice", "One"]);
    });

    expect(appendAttendeeRow).not.toHaveBeenCalled();
    expect(result.current.attendees).toEqual([]);
  });

  it("applies the optimistic update immediately with real payment fields on the general 'tickets' sheet", async () => {
    let resolveAppend: (v: any) => void;
    mockedAppendSheetData.mockReturnValue(new Promise((resolve) => { resolveAppend = resolve; }));
    const row = new Array(22).fill("");
    row[0] = "Alice"; row[1] = "One"; row[2] = "alice@example.com"; row[19] = "Manual"; row[20] = "Pending"; row[21] = "$35";

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    await act(async () => {
      result.current.addAttendee("tickets", row);
    });

    expect(result.current.attendees).toHaveLength(1);
    expect(result.current.attendees[0]).toMatchObject({
      firstName: "Alice",
      lastName: "One",
      email: "alice@example.com",
      paymentMethod: "Manual",
      paymentStatus: "Pending",
      totalPaid: "$35",
    });

    await act(async () => {
      resolveAppend!(undefined);
    });
  });

  it("hardcodes paymentMethod/paymentStatus/totalPaid to Comp/Paid/$0 on staff/sponsor sheets", async () => {
    let resolveAppend: (v: any) => void;
    mockedAppendSheetData.mockReturnValue(new Promise((resolve) => { resolveAppend = resolve; }));
    const row = ["Staff", "Member", "staff@example.com"];

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    await act(async () => {
      result.current.addAttendee("staff tickets", row);
    });

    expect(result.current.attendees[0]).toMatchObject({ paymentMethod: "Comp", paymentStatus: "Paid", totalPaid: "$0" });

    await act(async () => {
      resolveAppend!(undefined);
    });
  });

  it("on success, sends the row to the attendee add route (recorded in Action History), re-fetches, and shows a success toast", async () => {
    mockedAppendSheetData.mockResolvedValue(undefined);
    const row = ["Alice", "One", "alice@example.com"];

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockedGetSheetData.mockClear();
    await act(async () => {
      await result.current.addAttendee("tickets", row);
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Attendee record synced successfully"));
    expect(appendAttendeeRow).toHaveBeenCalledWith("ss-id", "tickets", row);
    // fetchAttendees() re-reads every ticket tab after the add.
    expect(mockedGetSheetData.mock.calls).toEqual([
      ["ss-id", "tickets!A:Z"], ["ss-id", "staff tickets!A:Z"], ["ss-id", "sponsor tickets!A:Z"],
    ]);
  });

  it("rolls back the optimistic add on a failed sync", async () => {
    mockedAppendSheetData.mockRejectedValue(new Error("append failed"));
    const row = ["Alice", "One", "alice@example.com"];

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    await act(async () => {
      await result.current.addAttendee("tickets", row);
    });

    await waitFor(() => expect(result.current.attendees).toEqual([]));
    expect(toast.error).toHaveBeenCalledWith("Failed to sync updates. Your local change has been reverted.");
  });

  it("scopes a failed rollback to just the one new entry - a second add's already-committed change must survive", async () => {
    // The success path fires an un-awaited fetchAttendees() refetch, so
    // getSheetData must reflect Alice's row being genuinely on the sheet
    // by the time that refetch resolves, or the refetch itself (not the
    // bug under test) would appear to wipe her out.
    mockedGetSheetData.mockImplementation((_id: string, range: string) => {
      if (range.startsWith("tickets")) return Promise.resolve({ values: TICKETS_ROWS });
      return Promise.resolve({ values: [] });
    });

    let resolveFirst: (v: any) => void;
    let rejectSecond: (e: any) => void;
    mockedAppendSheetData
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSecond = reject; }));

    const { result } = renderHook(() => useAttendeesData("ss-id"));

    act(() => {
      result.current.addAttendee("tickets", ["Alice", "One", "alice@example.com"]);
      result.current.addAttendee("tickets", ["Bob", "Two", "bob@example.com"]);
    });

    expect(result.current.attendees).toHaveLength(2);

    // First add succeeds - triggers the fire-and-forget fetchAttendees()
    // refetch, which will eventually replace state with the real sheet
    // data (just Alice, per TICKETS_ROWS above).
    act(() => {
      resolveFirst!(undefined);
    });
    await waitFor(() => expect(result.current.attendees.some(a => a.firstName === "Alice")).toBe(true));

    // Second add (Bob) fails after Alice's add already committed and the
    // refetch already landed.
    act(() => {
      rejectSecond!(new Error("append failed"));
    });

    // Bob's failed add must be rolled back, but Alice must still be
    // present - not both wiped out by Bob's rollback.
    await waitFor(() => {
      expect(result.current.attendees.some(a => a.firstName === "Bob")).toBe(false);
      expect(result.current.attendees.some(a => a.firstName === "Alice")).toBe(true);
    });
  });
});

describe("useAttendeesData.removeAttendee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when ticketsSpreadsheetId is empty", async () => {
    const { result } = renderHook(() => useAttendeesData(""));
    await act(async () => {
      await result.current.removeAttendee(makeAttendee());
    });

    expect(postJson).not.toHaveBeenCalled();
  });

  it("applies the optimistic removal immediately", async () => {
    let resolveClear: (v: any) => void;
    mockedDeleteAttendee.mockReturnValue(new Promise((resolve) => { resolveClear = resolve; }));

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    act(() => {
      result.current.setAttendees([makeAttendee({ id: "a1" })]);
    });

    await act(async () => {
      result.current.removeAttendee(makeAttendee({ id: "a1" }));
    });

    expect(result.current.attendees).toEqual([]);

    await act(async () => {
      resolveClear!(undefined);
    });
  });

  it("on success, asks the server to delete that sheet row (the permission-checked route) and shows a success toast", async () => {
    mockedDeleteAttendee.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAttendeesData("ss-id"));
    act(() => {
      result.current.setAttendees([makeAttendee({ id: "a1", sheet: "tickets", rowIndex: 5 })]);
    });

    await act(async () => {
      await result.current.removeAttendee(makeAttendee({ id: "a1", sheet: "tickets", rowIndex: 5 }));
    });

    expect(postJson).toHaveBeenCalledWith("/api/attendees/delete", { spreadsheetId: "ss-id", sheet: "tickets", rowIndex: 5 }, expect.any(String));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Attendee record cleared in spreadsheet"));
  });

  it("rolls back (re-adds) the removed attendee on a failed sync", async () => {
    mockedDeleteAttendee.mockRejectedValue(new Error("clear failed"));
    const attendee = makeAttendee({ id: "a1" });
    const { result } = renderHook(() => useAttendeesData("ss-id"));
    act(() => {
      result.current.setAttendees([attendee]);
    });

    await act(async () => {
      await result.current.removeAttendee(attendee);
    });

    await waitFor(() => expect(result.current.attendees).toEqual([attendee]));
    expect(toast.error).toHaveBeenCalledWith("Failed to sync updates. Your local change has been reverted.");
  });

  it("scopes a failed rollback to just the one removed attendee - a second removal's already-committed change must survive", async () => {
    const attendeeA = makeAttendee({ id: "a1", firstName: "Alice" });
    const attendeeB = makeAttendee({ id: "a2", firstName: "Bob" });

    let resolveFirst: (v: any) => void;
    let rejectSecond: (e: any) => void;
    mockedDeleteAttendee
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSecond = reject; }));

    const { result } = renderHook(() => useAttendeesData("ss-id"));
    act(() => {
      result.current.setAttendees([attendeeA, attendeeB]);
    });

    let firstCall: Promise<void>;
    let secondCall: Promise<void>;
    act(() => {
      firstCall = result.current.removeAttendee(attendeeA);
      secondCall = result.current.removeAttendee(attendeeB);
    });

    expect(result.current.attendees).toEqual([]);

    // Removal of A succeeds.
    await act(async () => {
      resolveFirst!(undefined);
      await firstCall;
    });

    // Removal of B fails after A's removal already committed.
    await act(async () => {
      rejectSecond!(new Error("clear failed"));
      await secondCall.catch(() => {});
    });

    // B must be restored, but A must stay removed - not both restored.
    expect(result.current.attendees).toEqual([attendeeB]);
  });
});

describe("useAttendeesData - volunteers (badgesOnly, ROADMAP B4)", () => {
  it("loads the badge-only ticket list from the server and never reads the ticket spreadsheet", async () => {
    vi.mocked(getSheetData).mockClear();
    const badge = makeAttendee({ email: "", phone: "", paymentMethod: "", totalPaid: "", ticketsPurchased: "" });
    vi.mocked(fetchWithRetry).mockResolvedValue({ ok: true, json: async () => ({ attendees: [badge] }) } as Response);
    const { result } = renderHook(() => useAttendeesData("ss-id", true));

    await act(() => result.current.fetchAttendees());

    expect(fetchWithRetry).toHaveBeenCalledWith("/api/attendees/badges", expect.anything());
    expect(getSheetData).not.toHaveBeenCalled();
    expect(result.current.attendees).toEqual([badge]);
  });
});
