import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/itemService", () => ({ updateItem: vi.fn(async () => ({})), deleteItem: vi.fn(async () => ({})) }));
vi.mock("../services/bundleService", () => ({ restoreBundle: vi.fn(async () => ({})) }));
vi.mock("../services/userService", async (importActual) => ({
  roleChangeRefusal: (await importActual<typeof import("../services/userService")>()).roleChangeRefusal,
  getRole: vi.fn(),
  setRole: vi.fn(async () => {}),
}));

import { applyUndo, UndoRefusedError } from "../services/undoService";
import { updateItem, deleteItem } from "../services/itemService";
import { restoreBundle } from "../services/bundleService";
import { getRole, setRole } from "../services/userService";

/** A fake Sheets client whose every read returns `row` as one row. */
function sheetsReturning(row: unknown[]) {
  return { spreadsheets: { values: { get: vi.fn(async () => ({ data: { values: [row] } })), update: vi.fn() } } } as any;
}

// A-M of an Auction-Items row: id, category, name, description, value, opening, raise, donor, type, status, bundleId, bundled, multi.
const ROW = ["301", "Art", "Sunset Painting", "", "$100", "", "", "", "", "Active", "", "", false];

beforeEach(() => vi.clearAllMocks());

describe("applyUndo - items", () => {
  it("puts an edited item's old fields back through the normal item update, checking the row still holds the edit", async () => {
    await applyUndo(sheetsReturning(ROW), {
      kind: "items", spreadsheetId: "it",
      rows: [{ rowIndex: 5, name: "Sunset Painting", before: { value: "$80" }, after: { value: "$100" } }],
    }, "dan@orns.org");

    expect(updateItem).toHaveBeenCalledWith(expect.anything(), { spreadsheetId: "it", rowIndex: 5, changes: { value: "$80" }, expectedName: "Sunset Painting" });
  });

  it("brings a deleted item back by restoring its status (IDs are renumbered by the update, so ID is never compared)", async () => {
    const deleted = [...ROW]; deleted[0] = ""; deleted[9] = "Deleted";
    await applyUndo(sheetsReturning(deleted), {
      kind: "items", spreadsheetId: "it",
      rows: [{ rowIndex: 5, name: "Sunset Painting", before: { status: "Active" }, after: { status: "Deleted" } }],
    }, "dan@orns.org");

    expect(updateItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ changes: { status: "Active" } }));
  });

  it("refuses, changing nothing, when the item was edited again since", async () => {
    await expect(applyUndo(sheetsReturning(ROW), {
      kind: "items", spreadsheetId: "it",
      rows: [{ rowIndex: 5, name: "Sunset Painting", before: { value: "$80" }, after: { value: "$120" } }],
    }, "dan@orns.org")).rejects.toBeInstanceOf(UndoRefusedError);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("deletes an added item only while its row still holds that active item", async () => {
    await applyUndo(sheetsReturning(ROW), { kind: "item-add", spreadsheetId: "it", rowIndex: 5, name: "Sunset Painting" }, "dan@orns.org");
    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), { spreadsheetId: "it", rowIndex: 5 });

    await expect(applyUndo(sheetsReturning(ROW), { kind: "item-add", spreadsheetId: "it", rowIndex: 5, name: "Something Else" }, "dan@orns.org"))
      .rejects.toBeInstanceOf(UndoRefusedError);
  });

  it("splits a bundle back up with the existing restore-bundle code", async () => {
    await applyUndo(sheetsReturning([]), { kind: "bundle", spreadsheetId: "it", bundleToken: "BND-1", bundleName: "Art Pack" }, "dan@orns.org");
    expect(restoreBundle).toHaveBeenCalledWith(expect.anything(), { spreadsheetId: "it", targetBundleToken: "BND-1" });
  });
});

describe("applyUndo - roles", () => {
  it("puts the old role back if it hasn't changed since, and refuses otherwise", async () => {
    vi.mocked(getRole).mockResolvedValueOnce("admin");
    await applyUndo(sheetsReturning([]), { kind: "role", email: "jane@orns.org", before: "user", after: "admin" }, "dan@orns.org");
    expect(setRole).toHaveBeenCalledWith("jane@orns.org", "user", "dan@orns.org");

    vi.mocked(getRole).mockResolvedValueOnce("full_admin");
    await expect(applyUndo(sheetsReturning([]), { kind: "role", email: "jane@orns.org", before: "user", after: "admin" }, "dan@orns.org"))
      .rejects.toBeInstanceOf(UndoRefusedError);
  });

  it.each([
    ["an address outside @orns.org", { email: "me@gmail.com", before: "full_admin", after: "user" }, "@orns.org"],
    ["the person clicking Undo", { email: "dan@orns.org", before: "full_admin", after: "user" }, "your own role"],
    ["a role that isn't one", { email: "jane@orns.org", before: "owner", after: "user" }, "Role must be"],
  ])("refuses, as the Users tab does, to change %s", async (_label, change, message) => {
    vi.mocked(getRole).mockResolvedValue("user");
    await expect(applyUndo(sheetsReturning([]), { kind: "role", ...change } as any, "dan@orns.org")).rejects.toThrow(message);
    expect(setRole).not.toHaveBeenCalled();
  });
});

describe("applyUndo - cells", () => {
  it("writes restored text starting with =, +, - or @ as text, but leaves numbers as numbers", async () => {
    const sheets = sheetsReturning(["a", "b", "c", "d", "e"]);
    await applyUndo(sheets, { kind: "cells", spreadsheetId: "it", range: "'x'!A1:E1", before: [["=SUM(A1)", "@x", "-5", "+1.5", "-A1"]], after: [["a", "b", "c", "d", "e"]] }, "dan@orns.org");
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { values: [["'=SUM(A1)", "'@x", "-5", "+1.5", "'-A1"]] } }));
  });

  it("treats TRUE/true, 150/'150' and blank/missing as the same when checking nothing changed", async () => {
    const sheets = sheetsReturning(["312", 150]);
    await applyUndo(sheets, { kind: "cells", spreadsheetId: "bm", range: "Bid-Management!A5:B5", before: [["", ""]], after: [[312, "150"]] }, "dan@orns.org");
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ range: "Bid-Management!A5:B5", requestBody: { values: [["", ""]] } }));
  });
});
