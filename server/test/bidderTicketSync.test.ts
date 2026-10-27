import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TicketPerson } from "../services/ticketPeople";

// setup.ts mocks this module for every other test; this file tests the real one.
const { planBidderSync, syncBidderNamesWithTickets } =
  await vi.importActual<typeof import("../services/bidderTicketSync")>("../services/bidderTicketSync");

const person = (ref: string, firstName: string, lastName: string, email = ""): TicketPerson => ({ ref, firstName, lastName, email });
const bidder = (id: string, firstName: string, lastName: string, email = "", ref = "") => ({ id, rowNumber: Number(id) - 99, firstName, lastName, email, ref });
const plan = (bidders: ReturnType<typeof bidder>[], people: TicketPerson[]) =>
  Object.fromEntries(planBidderSync(bidders, people).map(({ bidder: b, person: p }) => [b.id, p.ref]));

describe("planBidderSync", () => {
  it("keeps a recorded tie when the ticket's name was edited (the email still matches)", () => {
    expect(plan([bidder("101", "Amy/chris", "Jimieson", "amyj@orns.org", "staff tickets!2")], [person("staff tickets!2", "Amy & Chris", "Jimieson", "amyj@orns.org")]))
      .toEqual({ "101": "staff tickets!2" });
  });

  it("keeps a recorded tie when both name and email were changed in the sheet, if nobody else is that person", () => {
    expect(plan([bidder("101", "Old", "Name", "old@x.org", "tickets!2")], [person("tickets!2", "New", "Person", "new@x.org")]))
      .toEqual({ "101": "tickets!2" });
  });

  it("drops a tie whose row now holds exactly another bidder (rows sorted by hand), and matches both again", () => {
    const bidders = [bidder("101", "Ann", "Lee", "ann@x.org", "tickets!2"), bidder("102", "Bo", "Ng", "bo@x.org", "tickets!3")];
    // The rows were swapped.
    const people = [person("tickets!2", "Bo", "Ng", "bo@x.org"), person("tickets!3", "Ann", "Lee", "ann@x.org")];
    expect(plan(bidders, people)).toEqual({ "101": "tickets!3", "102": "tickets!2" });
  });

  it("ties a bidder without one by their unique email, else their unique name", () => {
    const people = [person("tickets!2", "Amy & Chris", "Jimieson", "amyj@orns.org"), person("tickets!3", "Jane", "Jones", "")];
    expect(plan([bidder("101", "Amy/chris", "Jimieson", "amyj@orns.org"), bidder("102", "Jane", "Jones", "jane@orns.org")], people))
      .toEqual({ "101": "tickets!2", "102": "tickets!3" });
  });

  it("leaves a bidder untied when several ticket people match equally", () => {
    const people = [person("tickets!2", "Pat", "Lee", "family@x.org"), person("tickets!3", "Sam", "Lee", "family@x.org")];
    expect(plan([bidder("101", "Chris", "Lee", "family@x.org")], people)).toEqual({});
  });

  it("never ties two bidders to the same ticket person", () => {
    const people = [person("tickets!2", "Dan", "Sage", "dan@x.org")];
    expect(plan([bidder("101", "Dan", "Sage", "dan@x.org", "tickets!2"), bidder("102", "Dan", "Sage", "dan@x.org")], people)).toEqual({ "101": "tickets!2" });
  });
});

describe("syncBidderNamesWithTickets", () => {
  let batch: any[];
  function fakeSheets(ranges: Record<string, unknown[][]>) {
    batch = [];
    return {
      spreadsheets: {
        values: {
          get: vi.fn(async ({ range }: { range: string }) => ({ data: { values: ranges[range] ?? [] } })),
          update: vi.fn(async () => ({})),
          batchUpdate: vi.fn(async ({ requestBody }: any) => { batch.push(...requestBody.data); return {}; }),
        },
      },
    } as any;
  }
  const params = { spreadsheetId: "bm", ticketsSpreadsheetId: "tk", bidderNumbersSheet: "Bidder-Numbers", bidManagementSheet: "Bid-Management" };
  const HEADER = ["ID", "First Name", "Last Name", "Email"];
  const bnRow = (id: number, first: string, last: string, email: string, ref = "") => [id, first, last, email, "FALSE", "FALSE", "FALSE", "FALSE", "", "", "", "", "", "", ref];

  beforeEach(() => { batch = []; });

  it("copies a renamed ticket onto its bidder and the grid's name row, and records the tie", async () => {
    const sheets = fakeSheets({
      "'staff tickets'!A:C": [["First", "Last", "Email"], ["Amy & Chris", "Jimieson", "amyj@orns.org"]],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Amy/chris", "Jimieson", "amyj@orns.org")],
      "'Bid-Management'!1:2": [[101, ""], ["Amy/chris", "Jimieson"]],
      "'Bidder-Numbers'!L1:O1": [["a", "b", "c", "Ticket"]],
    });

    const renames = await syncBidderNamesWithTickets(sheets, params);

    expect(renames).toEqual([{ id: "101", before: { firstName: "Amy/chris", lastName: "Jimieson", email: "amyj@orns.org" }, after: { firstName: "Amy & Chris", lastName: "Jimieson", email: "amyj@orns.org" } }]);
    expect(batch).toEqual([
      { range: "'Bidder-Numbers'!B2:D2", values: [["Amy & Chris", "Jimieson", "amyj@orns.org"]] },
      { range: "'Bidder-Numbers'!O2", values: [["staff tickets!2"]] },
      { range: "'Bid-Management'!A2:B2", values: [["Amy & Chris", "Jimieson"]] },
    ]);
    expect(sheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ valueInputOption: "RAW" }) }));
  });

  it("copies a guest's edited name and email onto the guest's own bidder (guest slots on the tickets tab)", async () => {
    // Guest 1 on the tickets tab: H-J name/email, K "own bidder number".
    const row = ["Dan", "Sage", "dan@x.org", "", "2", "Yes", "", "Jimmie", "Smyth", "jimmie@new.org", "yes"];
    const sheets = fakeSheets({
      "'tickets'!A:S": [["H"], row],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Dan", "Sage", "dan@x.org", "tickets!2"), bnRow(102, "Jimmy", "Smith", "smith@smith.com", "tickets!2#1")],
      "'Bid-Management'!1:2": [[101, "", 102, ""], ["Dan", "Sage", "Jimmy", "Smith"]],
      "'Bidder-Numbers'!L1:O1": [["a", "b", "c", "Ticket"]],
    });

    const renames = await syncBidderNamesWithTickets(sheets, params);

    expect(renames.map((r) => [r.id, r.after])).toEqual([["102", { firstName: "Jimmie", lastName: "Smyth", email: "jimmie@new.org" }]]);
    expect(batch).toEqual([
      { range: "'Bidder-Numbers'!B3:D3", values: [["Jimmie", "Smyth", "jimmie@new.org"]] },
      { range: "'Bid-Management'!C2:D2", values: [["Jimmie", "Smyth"]] },
    ]);
  });

  it("writes nothing when every bidder already matches their ticket", async () => {
    const sheets = fakeSheets({
      "'tickets'!A:S": [["H"], ["Jane", "Jones", "jane@orns.org"]],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Jane", "Jones", "jane@orns.org", "tickets!2")],
    });
    expect(await syncBidderNamesWithTickets(sheets, params)).toEqual([]);
    expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("never blanks a bidder whose ticket row was cleared", async () => {
    const sheets = fakeSheets({
      "'tickets'!A:S": [["H"], ["", "", ""]],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Jane", "Jones", "jane@orns.org", "tickets!2")],
    });
    expect(await syncBidderNamesWithTickets(sheets, params)).toEqual([]);
    expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });
});
