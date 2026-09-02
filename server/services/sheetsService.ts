import { sheets_v4 } from 'googleapis';
import { normalizeRange } from '../utils/rangeUtils';

export interface SheetOp {
  spreadsheetId: string;
  range: string;
  newValues: any[][];
  type: 'UPDATE' | 'APPEND';
  appendedRange?: string;
  oldValues?: any[][];
}

export async function executeGoogleSheetsTransaction(
  sheets: sheets_v4.Sheets,
  operations: SheetOp[]
) {
  const stagedOps: SheetOp[] = [];
  
  // Phase 1: Stage and Verify Targets
  for (const op of operations) {
    const normalizedRange = normalizeRange(op.range);
    try {
      if (op.type === 'UPDATE') {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: op.spreadsheetId,
          range: normalizedRange,
        });
        stagedOps.push({ ...op, range: normalizedRange, oldValues: res.data.values || [] });
      } else if (op.type === 'APPEND') {
        const rangeParts = normalizedRange.split('!');
        const sheetName = rangeParts[0];
        await sheets.spreadsheets.values.get({
          spreadsheetId: op.spreadsheetId,
          range: `${sheetName}!A1`, 
        });
        stagedOps.push({ ...op, range: normalizedRange });
      }
    } catch (err: any) {
      throw new Error(`Transaction Staging Failed - Target not ready: ${op.spreadsheetId} ${op.range}. Error: ${err.message}`);
    }
  }
  
  // Phase 2: Commit Updates
  const completedOps: SheetOp[] = [];
  try {
    for (const op of stagedOps) {
      if (op.type === 'UPDATE') {
        await sheets.spreadsheets.values.update({
          spreadsheetId: op.spreadsheetId,
          range: op.range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: op.newValues }
        });
        completedOps.push(op);
      } else if (op.type === 'APPEND') {
        const appendRes = await sheets.spreadsheets.values.append({
          spreadsheetId: op.spreadsheetId,
          range: op.range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: op.newValues }
        });
        completedOps.push({ ...op, appendedRange: appendRes.data.updates?.updatedRange });
      }
    }
  } catch (commitError: any) {
    console.error("[Transaction] Commit failed! Initiating rollback process...", commitError.message);
    
    // Phase 3: Rollback on Failure
    const rollbackErrors = [];
    for (let i = completedOps.length - 1; i >= 0; i--) {
      const opToRevert = completedOps[i];
      try {
        if (opToRevert.type === 'UPDATE') {
           const writeValues = opToRevert.oldValues && opToRevert.oldValues.length > 0
            ? opToRevert.oldValues 
            : opToRevert.newValues.map((row: any[]) => row.map(() => "")); // clean out block if originally empty

           await sheets.spreadsheets.values.update({
             spreadsheetId: opToRevert.spreadsheetId,
             range: opToRevert.range,
             valueInputOption: "USER_ENTERED",
             requestBody: { values: writeValues }
           });
        } else if (opToRevert.type === 'APPEND' && opToRevert.appendedRange) {
           await sheets.spreadsheets.values.clear({
             spreadsheetId: opToRevert.spreadsheetId,
             range: opToRevert.appendedRange,
           });
        }
      } catch (rollbackErr: any) {
         rollbackErrors.push(`Failed to revert ${opToRevert.range}: ${rollbackErr.message}`);
      }
    }
    
    if (rollbackErrors.length > 0) {
      throw new Error(`Transaction failed, and rollback partially failed (Mismatched state): ${commitError.message} | Rollback issues: ${rollbackErrors.join(', ')}`);
    } else {
      throw new Error(`Transaction failed and safely rolled back: ${commitError.message}`);
    }
  }
}
