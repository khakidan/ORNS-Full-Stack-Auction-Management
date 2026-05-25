import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeGoogleSheetsTransaction, SheetOp } from "../services/sheetsService";
import { sheets_v4 } from "googleapis";

describe("sheetsService - executeGoogleSheetsTransaction", () => {
  let mockGet: any;
  let mockUpdate: any;
  let mockAppend: any;
  let mockClear: any;
  let mockSheetsClient: any;

  beforeEach(() => {
    mockGet = vi.fn();
    mockUpdate = vi.fn();
    mockAppend = vi.fn();
    mockClear = vi.fn();

    // Construct mock sheets client matching Sheets SDK design structure
    mockSheetsClient = {
      spreadsheets: {
        values: {
          get: mockGet,
          update: mockUpdate,
          append: mockAppend,
          clear: mockClear,
        },
      },
    } as unknown as sheets_v4.Sheets;
  });

  it("completes happy path operations successfully without rollback triggers", async () => {
    const spreadsheetId = "mock-spreadsheet-123";

    // Setup mock get to return some cell states for Phase 1 Staging
    mockGet.mockResolvedValue({
      data: {
        values: [["OriginalValue1"], ["OriginalValue2"]],
      },
    });

    mockUpdate.mockResolvedValue({ data: {} });

    const operations: SheetOp[] = [
      {
        spreadsheetId,
        range: "Sheet1!A1:A2",
        newValues: [["NewValue1"], ["NewValue2"]],
        type: "UPDATE",
      },
      {
        spreadsheetId,
        range: "Sheet1!B1:B2",
        newValues: [["OtherNewValue1"], ["OtherNewValue2"]],
        type: "UPDATE",
      },
    ];

    await executeGoogleSheetsTransaction(mockSheetsClient, operations);

    // Verify both UPDATES was processed 
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockClear).not.toBeCalled();
  });

  it("handles catastrophic transaction commit failures by triggering Phase 3 rollback", async () => {
    const spreadsheetId = "mock-spreadsheet-123";

    // Staging stage reads:
    // Op 0 original cells: [["OriginalCellA"]]
    // Op 1 original cells: [["OriginalCellB"]]
    // Op 2 original cells: [["OriginalCellC"]]
    mockGet
      .mockResolvedValueOnce({ data: { values: [["OriginalCellA"]] } })
      .mockResolvedValueOnce({ data: { values: [["OriginalCellB"]] } })
      .mockResolvedValueOnce({ data: { values: [["OriginalCellC"]] } });

    // Mock update: First update succeeds, second update throws a fatal Network Error!
    mockUpdate
      .mockResolvedValueOnce({ data: {} }) // Op 0 update works
      .mockRejectedValueOnce(new Error("Network Error on Update 2")); // Op 1 fails catastrophically!

    const operations: SheetOp[] = [
      {
        spreadsheetId,
        range: "Sheet1!A1",
        newValues: [["NewCellA"]],
        type: "UPDATE",
      },
      {
        spreadsheetId,
        range: "Sheet1!B1",
        newValues: [["NewCellB"]],
        type: "UPDATE",
      },
      {
        spreadsheetId,
        range: "Sheet1!C1",
        newValues: [["NewCellC"]],
        type: "UPDATE",
      },
    ];

    // Assert that executing the transaction raises a transaction failed exception
    await expect(
      executeGoogleSheetsTransaction(mockSheetsClient, operations)
    ).rejects.toThrow(/Transaction failed and safely rolled back: Network Error on Update 2/);

    // Verify staging calls
    expect(mockGet).toHaveBeenCalledTimes(3);

    // Verify commit was attempted:
    // It should try commit A (succeeds) and commit B (fails) and never reach C.
    expect(mockUpdate).toHaveBeenCalledTimes(3); 
    // Wait, why 3 update calls in mockUpdate? 
    // Call 1: Commit A
    // Call 2: Commit B (fails)
    // Call 3: Rollback of A (restoring [["OriginalCellA"]])

    // Verify rollback parameters: It rewrote OriginalCellA over Sheet1!A1
    expect(mockUpdate).toHaveBeenLastCalledWith({
      spreadsheetId,
      range: "'Sheet1'!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["OriginalCellA"]] },
    });
  });
});
