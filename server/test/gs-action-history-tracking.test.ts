/**
 * Tests the REAL source of the Items/Tickets spreadsheets'
 * ActionHistoryTracking.gs row builder (loaded via helpers/loadGasClass,
 * not a reimplementation): a direct sheet edit must produce the same 15
 * columns as the app's own Action History rows, and single-cell edits must
 * carry "cells" Undo Data the app's Undo understands.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";
import { ACTION_HISTORY_HEADER } from "../services/actionHistoryRows";

const load = (project: string) =>
  loadGasClasses([`scripts/GoogleAppsScriptsCode/${project}/ActionHistoryTracking.gs`], ["buildEditActionRow_"]).buildEditActionRow_;

function editEvent({ rows = 1, cols = 1, oldValue, value, email = "director@orns.org" }: { rows?: number; cols?: number; oldValue?: string; value?: string; email?: string }) {
  return {
    oldValue,
    value,
    user: { getEmail: () => email },
    range: {
      getSheet: () => ({ getName: () => "staff tickets" }),
      getA1Notation: () => (rows * cols === 1 ? "F57" : "F57:G58"),
      getNumRows: () => rows,
      getNumColumns: () => cols,
    },
  };
}

const NOW = new Date("2026-03-14T20:15:00Z");

describe("ActionHistoryTracking.gs buildEditActionRow_", () => {
  it("records a single-cell edit with who made it, the old and new value, and Undo Data the app can reverse", () => {
    const row = load("TicketsSpreadsheet")(editEvent({ oldValue: "Pending", value: "Paid" }), NOW, "act-9", "tk-sheet");

    expect(row).toHaveLength(ACTION_HISTORY_HEADER.length);
    expect(row.slice(0, 13)).toEqual([
      "act-9", "2026-03-14T20:15:00.000Z", "director@orns.org", "Spreadsheet editor", "Sheet edit", "Tickets", "Sheet edit",
      "'staff tickets'!F57", `Changed 'staff tickets'!F57 from "Pending" to "Paid" in the spreadsheet`, "Pending", "Paid", "'staff tickets'!F57", "",
    ]);
    expect(JSON.parse(row[14])).toEqual({ kind: "cells", spreadsheetId: "tk-sheet", range: "'staff tickets'!F57", before: [["Pending"]], after: [["Paid"]] });
  });

  it("treats a cell that was empty, or was cleared, as blank", () => {
    const row = load("TicketsSpreadsheet")(editEvent({ value: "New" }), NOW, "a", "tk");
    expect(JSON.parse(row[14]).before).toEqual([[""]]);
    const cleared = load("TicketsSpreadsheet")(editEvent({ oldValue: "Old" }), NOW, "a", "tk");
    expect(JSON.parse(cleared[14]).after).toEqual([[""]]);
  });

  it("records a multi-cell edit (a paste) by range only, and marks it as not undoable", () => {
    const row = load("TicketsSpreadsheet")(editEvent({ rows: 2, cols: 2 }), NOW, "a", "tk");
    expect(row[8]).toContain("4 cells");
    expect(row[12]).toBe("Can't be undone: several cells were edited at once");
    expect(row[14]).toBe("");
  });

  it("keeps a typed value starting with = as text, so the log never runs it as a formula", () => {
    const row = load("TicketsSpreadsheet")(editEvent({ oldValue: "x", value: "=IMPORTRANGE(1)" }), NOW, "a", "tk");
    expect(row[10]).toBe("'=IMPORTRANGE(1)");
  });

  it("in the Items spreadsheet, records the Auction Items area and takes the same lock as the app's item writes", () => {
    const row = load("ItemsSpreadsheet")(editEvent({ oldValue: "$100", value: "$120" }), NOW, "a", "it-sheet");
    expect(row[5]).toBe("Auction Items");
    expect(JSON.parse(row[14]).lock).toBe("auction-items:it-sheet");
  });
});
