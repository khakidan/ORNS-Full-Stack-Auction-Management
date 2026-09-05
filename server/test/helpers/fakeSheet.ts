/**
 * A minimal in-memory fake of the Apps Script Spreadsheet/Sheet/Range API
 * surface that GlobalVariables-derived classes across both the
 * BidManagementSpreadsheet and ItemsSpreadsheet reference copies actually
 * use, for injecting into their `overrides.activeSpreadSheet`. Only
 * implements what's needed by those call sites - not a general-purpose
 * Sheets API mock.
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

  getRange(a: number | string, b?: number, numRows?: number, numCols?: number): any {
    if (typeof a === "string") {
      // e.g. "A1:F1" - only used for header formatting, chain-safe no-op.
      return makeChainStub();
    }
    const row = a;
    const col = b as number;
    const data = this.data;

    // Bounded multi-row/col range, e.g. getRange(2, 1, lastRow - 1, lastCol)
    // - used by AuctionItemManager/ValidationManager's lazy `range` getters.
    // Real Apps Script pads short rows with "" up to numCols, never undefined.
    if (numRows !== undefined && numCols !== undefined) {
      const rows = data.slice(row - 1, row - 1 + numRows).map((r) => {
        const padded = [...r];
        while (padded.length < numCols) padded.push("");
        return padded.slice(0, numCols);
      });
      return {
        getValues: () => rows,
        setValues: (values: any[][]) => {
          values.forEach((v, i) => {
            data[row - 1 + i] = [...v];
          });
        },
      };
    }

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

  getLastRow() {
    return this.data.length;
  }

  getLastColumn() {
    return this.data.reduce((max, row) => Math.max(max, row.length), 0);
  }

  appendRow(row: any[]) {
    this.data.push(row);
  }
}

export class FakeSpreadsheet {
  private sheets: Record<string, FakeSheet> = {};
  private sheetOrder: string[] = [];

  addSheet(name: string, data: any[][] = []) {
    if (!(name in this.sheets)) this.sheetOrder.push(name);
    this.sheets[name] = new FakeSheet(data);
    return this.sheets[name];
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets[name] || null;
  }

  insertSheet(name: string) {
    return this.addSheet(name);
  }

  /** Sheets in insertion order - used by callers that fall back to the
   * workbook's first tab when a specific sheet name isn't found (e.g.
   * AuctionItemManager.gs's loadItemNameMap_). */
  getSheets(): FakeSheet[] {
    return this.sheetOrder.map((name) => this.sheets[name]);
  }
}
