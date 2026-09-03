/**
 * A minimal in-memory fake of the Apps Script Spreadsheet/Sheet/Range API
 * surface that GlobalVariables-derived classes and PayPalSweeper.gs's
 * checkPendingPayPalInvoices actually use, for injecting into their
 * `overrides.activeSpreadSheet`. Only implements what's needed by those
 * call sites - not a general-purpose Sheets API mock.
 */

function makeChainStub(): any {
  const stub: any = {};
  stub.setFontWeight = () => stub;
  stub.setBackground = () => stub;
  return stub;
}

export class FakeSheet {
  data: any[][];

  constructor(initialData: any[][] = []) {
    this.data = initialData.map((row) => [...row]);
  }

  getDataRange() {
    // Real Apps Script returns a snapshot, not a live reference - callers
    // that read `data = sheet.getDataRange().getValues()` and later write
    // via `sheet.getRange(...).setValue(...)` must NOT see their own writes
    // reflected back into an already-read `data` array.
    const snapshot = this.data.map((row) => [...row]);
    return { getValues: () => snapshot };
  }

  getRange(a: number | string, b?: number, _numRows?: number, _numCols?: number): any {
    if (typeof a === "string") {
      // e.g. "A1:F1" - only used for header formatting, chain-safe no-op.
      return makeChainStub();
    }
    const row = a;
    const col = b as number;
    const data = this.data;
    return {
      setValue: (v: any) => {
        data[row - 1][col - 1] = v;
        return this;
      },
      getValue: () => data[row - 1]?.[col - 1],
      clearContent: () => {
        data[row - 1][col - 1] = "";
        return this;
      },
    };
  }

  appendRow(row: any[]) {
    this.data.push(row);
  }
}

export class FakeSpreadsheet {
  private sheets: Record<string, FakeSheet> = {};

  addSheet(name: string, data: any[][] = []) {
    this.sheets[name] = new FakeSheet(data);
    return this.sheets[name];
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets[name] || null;
  }

  insertSheet(name: string) {
    return this.addSheet(name);
  }
}
