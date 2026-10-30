import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TicketPerson } from "../services/ticketPeople";
import type { ActionEntry } from "../services/actionLog";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { _resetConfigCacheForTesting } from "../services/configService";

// setup.ts mocks this module for every other test; this file tests the real one.
const { planBidderSync, syncBidderNamesWithTickets, syncBiddersWith } =
  await vi.importActual<typeof import("../services/bidderTicketSync")>("../services/bidderTicketSync");

const person = (ref: string, firstName: string, lastName: string, email = ""): TicketPerson => ({ ref, firstName, lastName, email });
const bidder = (id: string, firstName: string, lastName: string, email = "", ref = "") => ({ id, rowNumber: Number(id) - 99, firstName, lastName, email, ref });
const plan = (bidders: ReturnType<typeof bidder>[], people: TicketPerson[], setUpNumbers?: Map<string, number>) =>
  Object.fromEntries(planBidderSync(bidders, people, setUpNumbers).ties.map(({ bidder: b, person: p }) => [b.id, p.ref]));

describe("planBidderSync", () => {
  it("keeps a recorded tie when the ticket's name was edited (the email still matches)", () => {
    expect(plan([bidder("101", "Amy/chris", "Jimieson", "amyj@orns.org", "staff tickets!2")], [person("staff tickets!2", "Amy & Chris", "Jimieson", "amyj@orns.org")]))
      .toEqual({ "101": "staff tickets!2" });
  });

  it("drops a recorded tie when the row shares neither name nor email - someone new has the row - and lists them as new", () => {
    // The refunded buyer's row was deleted; the next purchase landed on the same row number.
    const result = planBidderSync([bidder("101", "Old", "Name", "old@x.org", "tickets!2")], [person("tickets!2", "New", "Person", "new@x.org")]);
    expect(result.ties).toEqual([]);
    expect(result.replaced.map((b) => b.id)).toEqual(["101"]);
    expect(result.newPeople.map((p) => p.ref)).toEqual(["tickets!2"]);
  });

  it("never ties a bidder who lost their row by bidder number, even when Set Up would give the newcomer that number", () => {
    const people = [person("tickets!2", "Dan", "Sage", "dan@x.org"), person("tickets!3", "New", "Buyer", "new@x.org")];
    const numbers = new Map([["tickets!2", 101], ["tickets!3", 102]]);
    const bidders = [bidder("101", "Dan", "Sage", "dan@x.org", "tickets!2"), bidder("102", "Refunded", "Buyer", "gone@x.org", "tickets!3")];
    expect(plan(bidders, people, numbers)).toEqual({ "101": "tickets!2" });
    // Nor once their column O says so.
    expect(plan([bidders[0], { ...bidders[1], ref: "tickets!3 - now someone else" }], people, numbers)).toEqual({ "101": "tickets!2" });
  });

  it("a bidder who lost their row is still found again by email or name elsewhere", () => {
    const people = [person("tickets!2", "New", "Buyer", "new@x.org"), person("tickets!3", "Old", "Name", "old@x.org")];
    const result = planBidderSync([bidder("101", "Old", "Name", "old@x.org", "tickets!2")], people);
    expect(result.ties.map((t) => [t.bidder.id, t.person.ref])).toEqual([["101", "tickets!3"]]);
    expect(result.replaced).toEqual([]);
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

  it("ties guests whose name and email both changed by their bidder number, when Set Up's order still holds", () => {
    // Bidders 116/117 were Dan Sage's guests 1 and 2; both were renamed (new emails too) before ties existed.
    const people = [person("tickets!2", "Dan", "Sage", "dan@x.org"), person("tickets!2#1", "Guest", "One", "g1@x.org"), person("tickets!2#2", "Guest", "Two", "")];
    const numbers = new Map([["tickets!2", 115], ["tickets!2#1", 116], ["tickets!2#2", 117]]);
    const bidders = [bidder("115", "Dan", "Sage", "dan@x.org"), bidder("116", "Jimmy", "Smith", "smith@smith.com"), bidder("117", "Amy", "Sedaris", "sedaris@gmail.com")];
    expect(plan(bidders, people, numbers)).toEqual({ "115": "tickets!2", "116": "tickets!2#1", "117": "tickets!2#2" });
  });

  it("doesn't use bidder numbers when the tied bidders show the order has shifted", () => {
    const people = [person("tickets!2", "Dan", "Sage", "dan@x.org"), person("tickets!2#1", "Guest", "One", "g1@x.org")];
    // Dan is 115, but Set Up would now number him 114 - the order moved.
    const numbers = new Map([["tickets!2", 114], ["tickets!2#1", 116]]);
    const bidders = [bidder("115", "Dan", "Sage", "dan@x.org"), bidder("116", "Jimmy", "Smith", "smith@smith.com")];
    expect(plan(bidders, people, numbers)).toEqual({ "115": "tickets!2" });
  });

  it("lists ticket people with no bidder as new, once, but not a repeat of an existing bidder", () => {
    const people = [person("staff tickets!2", "Jane", "Jones", "jane@x.org"), person("tickets!5", "Jane", "Jones", "jane@x.org"), person("tickets!6", "New", "Buyer", "new@x.org"), person("tickets!7", "New", "Buyer", "new@x.org")];
    const result = planBidderSync([bidder("101", "Jane", "Jones", "jane@x.org", "staff tickets!2")], people);
    expect(result.newPeople.map((p) => p.ref)).toEqual(["tickets!6"]);
    expect(result.orphans).toEqual([]);
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
      "'Bid-Management'!1:5": [[101, ""], ["Amy/chris", "Jimieson"]],
      "'Bidder-Numbers'!L1:O1": [["a", "b", "c", "Ticket"]],
    });

    const renames = await syncBidderNamesWithTickets(sheets, params);

    expect(renames.renamed).toEqual([{ id: "101", before: { firstName: "Amy/chris", lastName: "Jimieson", email: "amyj@orns.org" }, after: { firstName: "Amy & Chris", lastName: "Jimieson", email: "amyj@orns.org" } }]);
    expect(batch).toEqual([
      { range: "'Bidder-Numbers'!B2:D2", values: [["Amy & Chris", "Jimieson", "amyj@orns.org"]] },
      { range: "'Bidder-Numbers'!O2", values: [["staff tickets!2"]] },
      { range: "'Bid-Management'!A2:B2", values: [["Amy & Chris", "Jimieson"]] },
    ]);
    expect(sheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ valueInputOption: "RAW" }) }));
  });

  it("copies a guest's edited name onto the guest's own bidder (guest slots on the tickets tab)", async () => {
    // Guest 1 on the tickets tab: H-J name/email, K "own bidder number".
    const row = ["Dan", "Sage", "dan@x.org", "", "2", "Yes", "", "Jimmie", "Smyth", "smith@smith.com", "yes"];
    const sheets = fakeSheets({
      "'tickets'!A:S": [["H"], row],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Dan", "Sage", "dan@x.org", "tickets!2"), bnRow(102, "Jimmy", "Smith", "smith@smith.com", "tickets!2#1")],
      "'Bid-Management'!1:5": [[101, "", 102, ""], ["Dan", "Sage", "Jimmy", "Smith"]],
      "'Bidder-Numbers'!L1:O1": [["a", "b", "c", "Ticket"]],
    });

    const renames = await syncBidderNamesWithTickets(sheets, params);

    expect(renames.renamed.map((r) => [r.id, r.after])).toEqual([["102", { firstName: "Jimmie", lastName: "Smyth", email: "smith@smith.com" }]]);
    expect(batch).toEqual([
      { range: "'Bidder-Numbers'!B3:D3", values: [["Jimmie", "Smyth", "smith@smith.com"]] },
      { range: "'Bid-Management'!C2:D2", values: [["Jimmie", "Smyth"]] },
    ]);
  });

  describe("adding bidders for new people on the tickets", () => {
    const tickets = { "'tickets'!A:S": [["H"], ["Jane", "Jones", "jane@orns.org"], ["New", "Buyer", "NEW@x.org"]] };
    const bnRows = [HEADER, bnRow(101, "Jane", "Jones", "jane@orns.org", "tickets!2")];
    function withState(state: string, extra: Record<string, unknown[][]> = {}) {
      const sheets = fakeSheets({ ...tickets, "'Bidder-Numbers'!A:O": bnRows, "'Auction-Status'!A2": [[state]], "'Bidder-Numbers'!L1:O1": [["a", "b", "c", "Ticket"]], ...extra });
      sheets.spreadsheets.get = vi.fn(async () => ({ data: { sheets: [{ properties: { sheetId: 7, title: "Bidder-Numbers" } }, { properties: { sheetId: 8, title: "Bid-Management", gridProperties: { columnCount: 2 } } }] } }));
      sheets.spreadsheets.batchUpdate = vi.fn(async () => ({}));
      return sheets;
    }

    it("in Prep, gives them the next bidder number, a Bidder-Numbers row and a grid column pair", async () => {
      const sheets = withState("PREP", { "'Bid-Management'!1:5": [[101, ""], ["Jane", "Jones"], ["Item #:", "Price:"]] });

      const result = await syncBidderNamesWithTickets(sheets, params);

      expect(result.added).toEqual([{ id: "102", firstName: "New", lastName: "Buyer", email: "new@x.org", ref: "tickets!3" }]);
      expect(batch).toEqual([{ range: "'Bidder-Numbers'!A3:O3", values: [[102, "New", "Buyer", "new@x.org", false, false, false, false, "", "", "", "", "", "", "tickets!3"]] }]);
      expect(sheets.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({
        range: "'Bid-Management'!C1:D3",
        requestBody: { values: [[102, ""], ["New", "Buyer"], ["Item #:", "Price:"]] },
      }));
    });

    it.each(["LIVE", "CLOSED"])("never once the auction is %s", async (state) => {
      const result = await syncBidderNamesWithTickets(withState(state), params);
      expect(result.added).toEqual([]);
      expect(batch).toEqual([]);
    });

    it("a bidder whose row now holds the new buyer keeps their name, is marked 'tickets!3 - now someone else', and the buyer gets their own number", async () => {
      const sheets = withState("PREP", {
        "'Bidder-Numbers'!A:O": [...bnRows, bnRow(102, "Refunded", "Person", "gone@x.org", "tickets!3")],
        "'Bid-Management'!1:5": [[101, "", 102, ""], ["Jane", "Jones", "Refunded", "Person"], ["Item #:", "Price:", "Item #:", "Price:"]],
      });

      const result = await syncBidderNamesWithTickets(sheets, params);

      expect(result.renamed).toEqual([]);
      expect(result.unlinked).toEqual(["102"]);
      expect(result.added).toEqual([{ id: "103", firstName: "New", lastName: "Buyer", email: "new@x.org", ref: "tickets!3" }]);
      expect(batch).toEqual([
        { range: "'Bidder-Numbers'!O3", values: [["tickets!3 - now someone else"]] },
        { range: "'Bidder-Numbers'!A4:O4", values: [[103, "New", "Buyer", "new@x.org", false, false, false, false, "", "", "", "", "", "", "tickets!3"]] },
      ]);
    });

    it("once marked 'tickets!3 - now someone else', that bidder no longer holds up new bidders, and isn't written again", async () => {
      const sheets = withState("PREP", { "'Bidder-Numbers'!A:O": [...bnRows, bnRow(102, "Refunded", "Person", "gone@x.org", "tickets!3 - now someone else")] });
      const result = await syncBidderNamesWithTickets(sheets, params);
      expect(result.added.map((a) => a.id)).toEqual(["103"]);
      expect(batch.map((w) => w.range)).toEqual(["'Bidder-Numbers'!A4:O4"]);
    });

    it("once Live, the bidder who lost their row is only marked - never renamed to the new buyer", async () => {
      const sheets = withState("LIVE", { "'Bidder-Numbers'!A:O": [...bnRows, bnRow(102, "Refunded", "Person", "gone@x.org", "tickets!3")] });
      const result = await syncBidderNamesWithTickets(sheets, params);
      expect(result).toEqual({ renamed: [], added: [], unlinked: ["102"] });
      expect(batch).toEqual([{ range: "'Bidder-Numbers'!O3", values: [["tickets!3 - now someone else"]] }]);
    });

    it("never while a bidder is still untied - they might be the 'new' person, renamed", async () => {
      // 103 matches nobody by email, name or Set Up number.
      const sheets = withState("PREP", { "'Bidder-Numbers'!A:O": [...bnRows, bnRow(103, "Old", "Name", "old@x.org")] });
      const result = await syncBidderNamesWithTickets(sheets, params);
      expect(result.added).toEqual([]);
      expect(result.unlinked).toEqual(["103"]);
    });
  });

  it("writes nothing when every bidder already matches their ticket", async () => {
    const sheets = fakeSheets({
      "'tickets'!A:S": [["H"], ["Jane", "Jones", "jane@orns.org"]],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Jane", "Jones", "jane@orns.org", "tickets!2")],
    });
    expect(await syncBidderNamesWithTickets(sheets, params)).toEqual({ renamed: [], added: [], unlinked: [] });
    expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("never blanks a bidder whose ticket row was cleared (they show as untied instead)", async () => {
    const sheets = fakeSheets({
      "'tickets'!A:S": [["H"], ["", "", ""]],
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Jane", "Jones", "jane@orns.org", "tickets!2")],
    });
    expect(await syncBidderNamesWithTickets(sheets, params)).toEqual({ renamed: [], added: [], unlinked: ["101"] });
    expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });
});

describe("syncBiddersWith - what it records in Action History", () => {
  const HEADER = ["ID", "First Name", "Last Name", "Email"];
  const bnRow = (id: number, first: string, last: string, email: string, ref = "") => [id, first, last, email, "FALSE", "FALSE", "FALSE", "FALSE", "", "", "", "", "", "", ref];

  /** Bid Management in Prep, with bidder 101 tied to the first ticket. */
  function sheetsWith(tickets: unknown[][]) {
    const ranges: Record<string, unknown[][]> = {
      "'tickets'!A:S": tickets,
      "'Bidder-Numbers'!A:O": [HEADER, bnRow(101, "Jane", "Jones", "jane@orns.org", "tickets!2")],
      "'Bid-Management'!1:5": [[101, ""], ["Jane", "Jones"], ["Item #:", "Price:"]],
      "'Auction-Status'!A2": [["PREP"]],
      "'Bidder-Numbers'!L1:O1": [["a", "b", "c", "Ticket"]],
    };
    return {
      spreadsheets: {
        get: vi.fn(async () => ({ data: { sheets: [{ properties: { sheetId: 7, title: "Bidder-Numbers" } }, { properties: { sheetId: 8, title: "Bid-Management", gridProperties: { columnCount: 2 } } }] } })),
        batchUpdate: vi.fn(async () => ({})),
        values: {
          get: vi.fn(async ({ range }: { range: string }) => ({ data: { values: ranges[range] ?? [] } })),
          update: vi.fn(async () => ({})),
          batchUpdate: vi.fn(async () => ({})),
        },
      },
    } as any;
  }

  beforeEach(async () => {
    _resetConfigCacheForTesting();
    await getAdminFirestore().collection("settings").doc("global").set({ bidManagementSpreadsheetId: "bm", auctionTicketsSpreadsheetId: "tk" });
  });

  it("records a renamed bidder and a new one, each with what changed", async () => {
    const record = vi.fn(async (_entry: ActionEntry) => {});
    const sheets = sheetsWith([["H"], ["Jane", "Jonas", "jane@orns.org"], ["New", "Buyer", "new@x.org"]]);

    await syncBiddersWith(sheets, record);

    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      {
        area: "Bid Management",
        action: "Update bidders from tickets",
        target: "Bidder 101",
        summary: "Bidder 101: Jane Jones <jane@orns.org> -> Jane Jonas <jane@orns.org>",
        before: [{ id: "101", firstName: "Jane", lastName: "Jones", email: "jane@orns.org" }],
        after: [{ id: "101", firstName: "Jane", lastName: "Jonas", email: "jane@orns.org" }],
        notUndoableReason: expect.stringMatching(/\S/),
      },
      {
        area: "Bid Management",
        action: "Add bidders from tickets",
        target: "Bidder 102",
        summary: "New on the tickets since Set Up: Bidder 102 New Buyer <new@x.org>",
        after: [{ id: "102", firstName: "New", lastName: "Buyer", email: "new@x.org", ref: "tickets!3" }],
        notUndoableReason: expect.stringMatching(/\S/),
      },
    ]);
  });

  it("records nothing when nothing changed", async () => {
    const record = vi.fn(async (_entry: ActionEntry) => {});

    await syncBiddersWith(sheetsWith([["H"], ["Jane", "Jones", "jane@orns.org"]]), record);

    expect(record).not.toHaveBeenCalled();
  });
});
