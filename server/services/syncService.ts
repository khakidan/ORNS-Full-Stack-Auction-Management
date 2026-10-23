import { sheets_v4 } from "googleapis";
import { BIDDER_NUMBERS_HEADERS } from "../utils/bidderNumbersHeaders";
import { BIDDER_COL, TICKETS_COL, WALK_IN_PAYMENT_METHOD } from "../utils/sheetColumns";
import { guestRowIndicesForSheet } from "../../src/lib/attendeeSheetColumns";

/** Rows as the Sheets API returns them (cells may be strings, numbers, booleans or missing). */
type SheetRows = unknown[][];

/** One built Bidder-Numbers row, A-K: ID, First, Last, Email, 4 blank checkboxes, 3 blank strings. */
type BidderNumbersRow = [number, string, string, string, boolean, boolean, boolean, boolean, string, string, string];


const cell = (row: unknown[] | undefined, index: number): string => String(row?.[index] ?? "").trim();

/** Reads the staff/tickets/sponsor rows from the external Auction Tickets spreadsheet. A missing tab reads as empty. */
async function fetchTicketSheetRows(sheets: sheets_v4.Sheets, auctionTicketSheetsID: string): Promise<{ ticketsRows: SheetRows; staffRows: SheetRows; sponsorRows: SheetRows }> {
  const read = async (range: string): Promise<SheetRows> => {
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range });
      return res.data.values || [];
    } catch (e) {
      console.warn(`[Sync warnings] ${range} tab download bypassed or missing:`, e);
      return [];
    }
  };
  const ticketsRows = await read("'tickets'!A:S");
  const staffRows = await read("'staff tickets'!A:C");
  const sponsorRows = await read("'sponsor tickets'!A:C");
  return { ticketsRows, staffRows, sponsorRows };
}

/**
 * Pure transform: staff/tickets/sponsor rows -> deduped, sequentially
 * numbered Bidder-Numbers rows (ID, First, Last, Email, 4 blank booleans,
 * 3 blank strings), starting at 101. The iteration order is deliberate and
 * load-bearing - staff, then every ticket-buying primary, then every
 * guest-1 across all ticket rows, then every guest-2, then every guest-3,
 * then sponsors - and is shared by performSheetSync (the full "Set Up Bid
 * Management App" rebuild) and ensureBidderNumbersSheet (the narrower
 * "build it if missing" path bidder-label generation uses so labels can be
 * printed before Bid-Management is ever set up - see CHANGELOG.md). There
 * is exactly one implementation of this ordering here, never two copies
 * that could quietly drift apart.
 */
export function computeBidderNumbersRows(staffRows: SheetRows, ticketsRows: SheetRows, sponsorRows: SheetRows): BidderNumbersRow[] {
  const collectedBidders: [string, string, string][] = [];

  // Staff, primary ticket buyers and sponsors all start [First, Last, Email].
  const collectPeople = (rows: SheetRows) => {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && (row[0] || row[1])) {
        collectedBidders.push([cell(row, 0), cell(row, 1), cell(row, 2)]);
      }
    }
  };

  // Guests who asked for their own bidder number. A guest is real whenever
  // their own name is present - matches src/lib/attendeeParsing.ts's own
  // inclusion check, which never reads column G (row[6]). That used to
  // also require the separate "guest marker" checkbox in G, which silently
  // dropped any guest who opted in but never had it ticked, so their
  // labels were never generated.
  const collectGuests = (guestIndex: 1 | 2 | 3) => {
    const cols = guestRowIndicesForSheet("tickets")[guestIndex];
    const ownBidderCol = cols.ownBidderNumber!;
    for (let i = 1; i < ticketsRows.length; i++) {
      const row = ticketsRows[i];
      if (!row || row.length <= ownBidderCol) continue;
      const guestFirst = cell(row, cols.firstName);
      if (guestFirst !== "" && cell(row, ownBidderCol).toLowerCase() === "yes") {
        collectedBidders.push([guestFirst, cell(row, cols.lastName), cell(row, cols.email)]);
      }
    }
  };

  collectPeople(staffRows);
  collectPeople(ticketsRows);
  collectGuests(1);
  collectGuests(2);
  collectGuests(3);
  collectPeople(sponsorRows);

  // Drop repeats of the same person (same formatted name and email).
  const formatName = (str: string) => {
    const cleaned = str.trim();
    if (!cleaned) return "";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  };

  const finalBidders: BidderNumbersRow[] = [];
  const seenKey = new Set<string>();

  collectedBidders.forEach((b) => {
    const first = formatName(b[0]);
    const last = formatName(b[1]);
    const email = b[2].toLowerCase().trim();
    const hash = first + "|" + last + "|" + email;
    if (!seenKey.has(hash)) {
      seenKey.add(hash);
      finalBidders.push([101 + finalBidders.length, first, last, email, false, false, false, false, "", "", ""]);
    }
  });

  return finalBidders;
}

/** Writes computed Bidder-Numbers rows into the given sheet, then applies checkbox validation (Checked In/Proxy/Checked Out/Paid) and freezes the header row. */
async function writeBidderNumbersSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, bnSheetId: number, finalBidders: BidderNumbersRow[]): Promise<void> {
  const bidderNumbersValues = [BIDDER_NUMBERS_HEADERS, ...finalBidders];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Bidder-Numbers!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: bidderNumbersValues }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: bnSheetId,
              startRowIndex: 1,
              endRowIndex: 1 + finalBidders.length,
              startColumnIndex: BIDDER_COL.checkedIn,
              endColumnIndex: BIDDER_COL.paid + 1
            },
            rule: {
              condition: {
                type: "BOOLEAN"
              },
              showCustomUi: true
            }
          }
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: bnSheetId,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: "gridProperties.frozenRowCount"
          }
        }
      ]
    }
  });
}

/**
 * Builds the "Bidder-Numbers" sheet in the Bid-Management spreadsheet if
 * (and only if) it doesn't already hold real data - used by bidder-label
 * generation so labels can be printed before "Set Up Bid Management App"
 * has ever been run (the real auction workflow: labels are printed 2-3
 * days out, Bid-Management setup is one of the last things done, day-of -
 * see CHANGELOG.md). Deliberately idempotent: if Bidder-Numbers already
 * has data - whether from an earlier "Create Labels" run or a real "Set
 * Up Bid Management App" sync - this is a no-op, so numbers already
 * printed on a physical label never silently change underneath someone.
 * Shares computeBidderNumbersRows/writeBidderNumbersSheet with
 * performSheetSync, so there is exactly one implementation of the
 * numbering algorithm, not a second copy that could drift from it.
 */
export async function ensureBidderNumbersSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, auctionTicketSheetsID: string): Promise<{ created: boolean; count: number }> {

  if (!auctionTicketSheetsID) {
    throw new Error("Missing the Auction Tickets spreadsheet ID - configure it in Settings before creating bidder labels.");
  }

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bidder-Numbers!A2:A2" }).catch(() => ({ data: { values: [] } }));
  const alreadyPopulated = !!existing.data.values?.[0]?.[0];
  if (alreadyPopulated) return { created: false, count: 0 };

  const { ticketsRows, staffRows, sponsorRows } = await fetchTicketSheetRows(sheets, auctionTicketSheetsID);
  const finalBidders = computeBidderNumbersRows(staffRows, ticketsRows, sponsorRows);

  let meta = await sheets.spreadsheets.get({ spreadsheetId });
  let bnSheet = (meta.data.sheets || []).find((s) => s.properties?.title === "Bidder-Numbers");
  if (!bnSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "Bidder-Numbers" } } }] }
    });
    meta = await sheets.spreadsheets.get({ spreadsheetId });
    bnSheet = (meta.data.sheets || []).find((s) => s.properties?.title === "Bidder-Numbers");
  }
  const bnSheetId = bnSheet?.properties?.sheetId;
  if (bnSheetId === undefined || bnSheetId === null) {
    throw new Error("Failed to create or find the Bidder-Numbers sheet.");
  }

  await writeBidderNumbersSheet(sheets, spreadsheetId, bnSheetId, finalBidders);
  console.log(`[Bidder Labels] Bidder-Numbers was empty; built it with ${finalBidders.length} bidders so labels can print before Bid-Management setup.`);
  return { created: true, count: finalBidders.length };
}

/**
 * Reads the Bid-Management spreadsheet's "Bidder-Numbers" sheet (the single
 * source of truth, guaranteed populated by `ensureBidderNumbersSheet` before
 * this is called) and returns a flat, number-sorted { name, number } list
 * for bidder-label generation.
 *
 * This replaces what used to be a second, independent lookup inside
 * `scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs`'s
 * `getAllBidders()` - that GAS class re-read the Auction Tickets
 * spreadsheet's staff/tickets/sponsor sheets and re-matched each person
 * against Bidder-Numbers by a normalized name/email key that its own code
 * comment admitted "must stay byte-for-byte identical" to this file's
 * formatting logic. Reading the already-built Bidder-Numbers rows directly
 * needs no matching at all - the ID and name are already sitting right next
 * to each other in the same row - so there is no second implementation left
 * to drift out of sync.
 */
export async function getBidderLabelList(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<{ name: string; number: string }[]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bidder-Numbers!A2:D" });
  const rows = res.data.values || [];

  return rows
    .filter((row) => row && row[BIDDER_COL.id])
    .map((row) => ({
      name: `${row[BIDDER_COL.firstName] || ""} ${row[BIDDER_COL.lastName] || ""}`.trim(),
      number: String(row[BIDDER_COL.id])
    }))
    .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
}

/** _Settings key -> trimmed value (column A -> column B). A missing tab reads as no settings. */
async function readSettings(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Record<string, string>> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "_Settings!A:C" }).catch(() => ({ data: { values: [] as SheetRows } }));
  const settings: Record<string, string> = {};
  for (const row of res.data.values || []) {
    const key = String(row[0] ?? "");
    if (key && key !== "Setting Key") settings[key] = cell(row, 1);
  }
  return settings;
}

/**
 * Refuses a rebuild once a walk-in has been registered straight into
 * Bid-Management (registerWalkInBidder marks them "Auction Checkout" in
 * the 'tickets' sheet's column T). A rebuild renumbers Bidder-Numbers from
 * scratch, which could give that person's bids to a different number.
 */
async function assertNoWalkInsRegistered(sheets: sheets_v4.Sheets, auctionTicketSheetsID: string): Promise<void> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "'tickets'!A:T" }).catch(() => ({ data: { values: [] as SheetRows } }));
  const walkInNames = (res.data.values || []).slice(1)
    .filter((row) => cell(row, TICKETS_COL.paymentMethod) === WALK_IN_PAYMENT_METHOD)
    .map((row) => `${row[0] || ""} ${row[1] || ""}`.trim())
    .filter(Boolean);
  if (walkInNames.length > 0) {
    throw new Error(
      `Cannot re-sync: ${walkInNames.length} walk-in bidder(s) have already been registered directly (${walkInNames.join(", ")}). ` +
      `Re-running "Set Up Bid Management App" would rebuild Bidder-Numbers from scratch and could reassign or duplicate their ` +
      `bidder number, breaking bids already recorded against it. Only run sync before any walk-ins are registered.`
    );
  }
}

/** "2026-10-24_09-05-07" (local time), for the backup tab names. */
function backupTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/**
 * Renames any existing Bid-Management / Bidder-Numbers tabs to
 * "<name> (Backup <time>)" and adds fresh empty ones, in one batch.
 * Returns the new tabs' sheet IDs.
 */
async function archiveAndCreateTabs(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<{ bnSheetId: number; bmSheetId: number }> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets || [];
  const timestamp = backupTimestamp(new Date());

  const requests: sheets_v4.Schema$Request[] = [];
  for (const title of ["Bid-Management", "Bidder-Numbers"]) {
    const tab = existing.find((s) => s.properties?.title === title);
    if (tab) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: tab.properties?.sheetId, title: `${title} (Backup ${timestamp})` },
          fields: "title"
        }
      });
    }
  }
  requests.push({ addSheet: { properties: { title: "Bidder-Numbers" } } });
  requests.push({ addSheet: { properties: { title: "Bid-Management" } } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  const updated = (await sheets.spreadsheets.get({ spreadsheetId })).data.sheets || [];
  const bnSheetId = updated.find((s) => s.properties?.title === "Bidder-Numbers")?.properties?.sheetId;
  const bmSheetId = updated.find((s) => s.properties?.title === "Bid-Management")?.properties?.sheetId;
  if (bnSheetId == null || bmSheetId == null) {
    throw new Error("Sheet creation verification failed.");
  }
  return { bnSheetId, bmSheetId };
}

/**
 * The Bid-Management grid's first 25 rows: per bidder two columns with
 * the ID, then First/Last, then "Item #:"/"Price:", then empty bid rows.
 */
export function buildBidManagementGrid(bidders: BidderNumbersRow[]): (string | number)[][] {
  const ids: (string | number)[] = [];
  const names: string[] = [];
  const captions: string[] = [];
  for (const [id, first, last] of bidders) {
    ids.push(id, "");
    names.push(first, last);
    captions.push("Item #:", "Price:");
  }
  const grid: (string | number)[][] = [ids, names, captions];
  for (let r = 4; r <= 25; r++) grid.push(Array(bidders.length * 2).fill(""));
  return grid;
}

/** Freezes the grid's 3 header rows, merges each bidder's ID cell across their two columns and centres the headers. */
function bidManagementFormatRequests(bmSheetId: number, bidderCount: number): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [{
    updateSheetProperties: {
      properties: { sheetId: bmSheetId, gridProperties: { frozenRowCount: 3 } },
      fields: "gridProperties.frozenRowCount"
    }
  }];
  for (let i = 0; i < bidderCount; i++) {
    const columns = { startColumnIndex: 2 * i, endColumnIndex: 2 * i + 2 };
    requests.push({
      mergeCells: { range: { sheetId: bmSheetId, startRowIndex: 0, endRowIndex: 1, ...columns }, mergeType: "MERGE_ALL" }
    });
    requests.push({
      repeatCell: {
        range: { sheetId: bmSheetId, startRowIndex: 0, endRowIndex: 3, ...columns },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat.horizontalAlignment"
      }
    });
  }
  return requests;
}

/**
 * "Set Up Bid Management App": backs up any existing Bid-Management and
 * Bidder-Numbers tabs, then rebuilds both from the Auction Tickets
 * spreadsheet. Refused once walk-ins exist (assertNoWalkInsRegistered).
 */
export async function performSheetSync(sheets: sheets_v4.Sheets, spreadsheetId: string, customAuctionTicketSheetsID?: string) {
  const settings = await readSettings(sheets, spreadsheetId);
  const auctionTicketSheetsID = customAuctionTicketSheetsID || settings["auctionTicketSheetsID"];
  if (!auctionTicketSheetsID) {
    throw new Error("Missing 'auctionTicketSheetsID' in settings. Please configure settings first.");
  }

  await assertNoWalkInsRegistered(sheets, auctionTicketSheetsID);

  const { bnSheetId, bmSheetId } = await archiveAndCreateTabs(sheets, spreadsheetId);

  const { ticketsRows, staffRows, sponsorRows } = await fetchTicketSheetRows(sheets, auctionTicketSheetsID);
  const finalBidders = computeBidderNumbersRows(staffRows, ticketsRows, sponsorRows);
  await writeBidderNumbersSheet(sheets, spreadsheetId, bnSheetId, finalBidders);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Bid-Management!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: buildBidManagementGrid(finalBidders) }
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: bidManagementFormatRequests(bmSheetId, finalBidders.length) }
  });

  console.log(`[Sync] Rebuilt Bidder-Numbers and Bid-Management in ${spreadsheetId} with ${finalBidders.length} bidders.`);
  return { success: true };
}
