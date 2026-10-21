/**
 * Test suite for the Document and Presentation Creation workflows (Production).
 * Covers endpoints that interface with Google Apps Script to generate labels, 
 * slideshows, guides, catalogs, and other collateral.
 *
 * NOTE: The bulk of the tests here are dynamically generated using a `testCases.forEach` loop
 * that maps over the various document creation endpoints to produce 18 total tests.
 */
import { authCookieHeader } from "./helpers/session";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, productionScriptCallLog,
         appsScriptCallCount, lastAppsScriptParams } from "./handlers";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = authCookieHeader(mockTokens);

// Node now resolves the Items spreadsheet's valid/sorted item list itself
// (itemDataService.ts's getValidSortedItems, the Node port of
// Class_AuctionItemManager.gs's getValidSortedItems - see
// docs/agents/refactor-opportunities.md's Code Hardening item #3) and
// forwards it as a parameter to every item-entry Apps Script call. This is
// exactly what parsing handlers.ts's default Auction-Items fixture (both
// rows "Active", already ID-ascending) resolves to. itemDataService.ts
// shares src/lib/itemParsing.ts's parseItemRows with the client, so its
// output (including allowMultipleWinners, added for the Bid Entry
// redesign's repeatable-item support) reaches this Apps Script parameter
// too - the default fixture has no "Allow Multiple Winners" column, so
// both items resolve to false.
const EXPECTED_DEFAULT_ITEMS = [
  {
    id: "801", category: "Food", name: "Pizza Night", description: "A pizza dinner",
    value: "$50.00", openingBid: "$22.50", minRaise: "$5.00", donor: "Joe's Pizza",
    itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "", allowMultipleWinners: false, rowIndex: 2,
  },
  {
    id: "803", category: "Food", name: "Sushi Dinner", description: "A sushi dinner",
    value: "$150.00", openingBid: "$67.50", minRaise: "$10.00", donor: "Sushi Place",
    itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "", allowMultipleWinners: false, rowIndex: 3,
  },
];

describe("Document and Presentation Creation workflow", () => {
  // Audit Confirmation: Ticket Document Creation is fully covered below.
  // The fetchFiles endpoint (/api/drive/files/:folderId) is a general Drive utility, and
  // apiCreateBidderLabels (/api/production/tickets/bidder-labels) is tested inside the
  // dynamic testCases list. No duplicate tests are created in accordance with rules.
  beforeEach(() => {
    process.env.SCRIPT_ID_ITEM_ENTRY = "dummy-item-script-id";
    process.env.SCRIPT_ID_TICKETS = "dummy-tickets-script-id";
  });

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  const testCases = [
    {
      endpoint: "/api/production/item-entry/bundling-doc",
      funcName: "apiCreateBundlingDoc",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/item-labels",
      funcName: "apiCreateItemLabels",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/slideshow",
      funcName: "apiCreateSlideshow",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/bidding-guide-cover",
      funcName: "apiCreateBiddingGuideCoverPage",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/bidding-guide-inner",
      funcName: "apiCreateBiddingGuideInnerPages",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/bid-sheets",
      funcName: "apiCreateBidSheets",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/catalog",
      funcName: "apiCreateCatalog",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/item-entry/table-tents",
      funcName: "apiCreateTableTents",
      payload: { folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" },
    },
    {
      endpoint: "/api/production/tickets/bidder-labels",
      funcName: "apiCreateBidderLabels",
      // The default MSW Bidder-Numbers handler (handlers.ts) already
      // returns populated data ([["42", "John", "Doe", "john@example.com", ...]]),
      // so ensureBidderNumbersSheet's idempotency check short-circuits as a
      // no-op here - the dedicated "bidder-labels: builds Bidder-Numbers
      // first" describe block below covers the build-when-missing path
      // explicitly. getBidderLabelList then reads that same row back as
      // the { name, number } list forwarded to the Apps Script call.
      payload: { folderId: "test-folder-id", bidManagementSpreadsheetId: "test-bm-id", auctionTicketsSpreadsheetId: "test-tickets-id" },
      expectedParams: ["test-folder-id", [{ name: "John Doe", number: "42" }]],
    },
  ];

  testCases.forEach(({ endpoint, funcName, payload, expectedParams }) => {
    describe(endpoint, () => {
      it(`happy path - successfully calls ${funcName}`, async () => {
        const response = await request(app)
          .post(endpoint)
          .set(authHeader)
          .send(payload);

        expect(response.status).toBe(200);
        expect(productionScriptCallLog).toContain(funcName);
        expect(appsScriptCallCount).toBe(1);
        // Confirms the payload fields actually reach the Apps Script call as
        // parameters, not just that some function got called - a payload
        // handling bug (wrong key, wrong array position) wouldn't have
        // failed this test before this assertion existed. Every item-entry
        // case now also expects Node's resolved item list as the 2nd
        // parameter (see EXPECTED_DEFAULT_ITEMS above).
        const expected = expectedParams ?? ((payload as any).folderId !== undefined ? [(payload as any).folderId, EXPECTED_DEFAULT_ITEMS] : []);
        expect(lastAppsScriptParams).toEqual(expected);
      });

      it("auth failure - returns 401 when unauthenticated", async () => {
        const response = await request(app)
          .post(endpoint)
          .send(payload);

        expect(response.status).toBe(401);
        expect(appsScriptCallCount).toBe(0);
      });
    });
  });

  it("runs the deployed script version (devMode: false) unless APPS_SCRIPT_DEV_MODE=true (ROADMAP.md M6)", async () => {
    const devModes: unknown[] = [];
    server.use(
      http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", async ({ request }) => {
        devModes.push(((await request.json()) as any).devMode);
        return HttpResponse.json({ response: { result: { success: true } } });
      })
    );
    const send = () => request(app).post("/api/production/item-entry/catalog").set(authHeader).send({ folderId: "f", spreadsheetId: "test-items-ss-id" });

    const previous = process.env.APPS_SCRIPT_DEV_MODE;
    try {
      delete process.env.APPS_SCRIPT_DEV_MODE;
      await send();
      process.env.APPS_SCRIPT_DEV_MODE = "true";
      await send();
    } finally {
      if (previous === undefined) delete process.env.APPS_SCRIPT_DEV_MODE;
      else process.env.APPS_SCRIPT_DEV_MODE = previous;
    }
    expect(devModes).toEqual([false, true]);
  });

  it("handles Apps Script execution failure with 500 status", async () => {
    server.use(
      http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", () => {
        return HttpResponse.json({
          error: {
            message: "Apps Script simulation failed"
          }
        });
      })
    );

    const response = await request(app)
      .post("/api/production/item-entry/bundling-doc")
      .set(authHeader)
      .send({ folderId: "fail-folder-id", spreadsheetId: "test-items-ss-id" });

    expect(response.status).toBe(500);
    expect(response.body?.success).not.toBe(true);
  });

  it("returns 400 (not 200/500) when the Apps Script function itself runs but reports success: false", async () => {
    // Distinct from the 500 case above: the Apps Script execution itself
    // succeeded (script.scripts.run didn't error), but the function's own
    // return value is a business-logic failure - e.g. GoogleAIStudio's
    // _executeGeneration caught a thrown error inside the generator and
    // returned { success: false, error } instead of letting it propagate.
    server.use(
      http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", () => {
        return HttpResponse.json({
          response: {
            result: { success: false, error: "Auction-Items sheet is empty" }
          }
        });
      })
    );

    const response = await request(app)
      .post("/api/production/item-entry/catalog")
      .set(authHeader)
      .send({ folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: "Auction-Items sheet is empty" });
  });

  it("returns 400 when spreadsheetId is missing", async () => {
    const response = await request(app)
      .post("/api/production/item-entry/catalog")
      .set(authHeader)
      .send({ folderId: "test-folder-id" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "spreadsheetId required" });
    expect(appsScriptCallCount).toBe(0);
  });

  it("returns 400 when the target environment's script ID isn't configured", async () => {
    const originalScriptId = process.env.SCRIPT_ID_ITEM_ENTRY;
    delete process.env.SCRIPT_ID_ITEM_ENTRY;

    const response = await request(app)
      .post("/api/production/item-entry/catalog")
      .set(authHeader)
      .send({ folderId: "test-folder-id", spreadsheetId: "test-items-ss-id" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Missing Target Environment Script ID" });
    expect(appsScriptCallCount).toBe(0);

    process.env.SCRIPT_ID_ITEM_ENTRY = originalScriptId;
  });

  describe("/api/production/tickets/bidder-labels - builds Bidder-Numbers first when it's missing", () => {
    // Real auction workflow (see CHANGELOG.md): bidder labels are printed
    // 2-3 days before the auction; "Set Up Bid Management App" - the thing
    // that used to be the only way Bidder-Numbers got created - isn't run
    // until day-of. This route now builds Bidder-Numbers itself first if
    // it's missing, so label generation doesn't depend on that ever having
    // happened.
    it("builds Bidder-Numbers from staff/tickets/sponsor rows, then still calls the label Apps Script function", async () => {
      let sheetCreated = false;
      let writtenValues: any[][] | null = null;

      server.use(
        // Bidder-Numbers starts empty (no data rows) - the idempotency check
        // must see this as "missing" - but once ensureBidderNumbersSheet has
        // written it, getBidderLabelList's own read-back must see those same
        // rows, so this simulates a real read-after-write instead of always
        // returning empty.
        http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split("/").pop() || "");
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({ values: writtenValues ? writtenValues.slice(1) : [] });
          }
          if (range.includes("'tickets'")) {
            return HttpResponse.json({
              values: [
                ["Header"],
                ["Alice", "One", "alice@example.com"],
              ],
            });
          }
          if (range.includes("staff")) return HttpResponse.json({ values: [["Header"], ["Staff", "Member", "staff@example.com"]] });
          if (range.includes("sponsor")) return HttpResponse.json({ values: [] });
          return HttpResponse.json({ values: [] });
        }),
        // No sheets exist yet in Bid-Management (matches the reported bug's "never set up" state).
        http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId", () => {
          if (sheetCreated) {
            return HttpResponse.json({ sheets: [{ properties: { title: "Bidder-Numbers", sheetId: 555 } }] });
          }
          return HttpResponse.json({ sheets: [] });
        }),
        http.post("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId\\:batchUpdate", async ({ request }) => {
          const body = await request.clone().json() as any;
          if (body.requests?.some((r: any) => r.addSheet?.properties?.title === "Bidder-Numbers")) {
            sheetCreated = true;
          }
          return HttpResponse.json({});
        }),
        http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ request }) => {
          const url = new URL(request.url);
          if (decodeURIComponent(url.pathname).includes("Bidder-Numbers")) {
            const body = await request.clone().json() as any;
            writtenValues = body.values;
          }
          return HttpResponse.json({ updatedRows: 1 });
        })
      );

      const response = await request(app)
        .post("/api/production/tickets/bidder-labels")
        .set(authHeader)
        .send({ folderId: "test-folder-id", bidManagementSpreadsheetId: "test-bm-id", auctionTicketsSpreadsheetId: "test-tickets-id" });

      expect(response.status).toBe(200);
      expect(productionScriptCallLog).toContain("apiCreateBidderLabels");

      expect(writtenValues).not.toBeNull();
      const dataRows = writtenValues!.slice(1);
      expect(dataRows.map((r: any[]) => `${r[1]} ${r[2]}`)).toEqual(["Staff Member", "Alice One"]);

      // The whole point of this fix: the freshly-built Bidder-Numbers rows
      // must flow straight through to the Apps Script call as a plain
      // { name, number } list - no second, independent re-derivation of
      // bidder numbers happens on the GAS side anymore.
      expect(lastAppsScriptParams).toEqual([
        "test-folder-id",
        [
          { name: "Staff Member", number: "101" },
          { name: "Alice One", number: "102" },
        ],
      ]);
    });

    it("does NOT rebuild Bidder-Numbers when it already has data - never reassigns a number already printed on a label", async () => {
      // Uses the default MSW handler (handlers.ts), which returns a
      // populated Bidder-Numbers sheet - no build-path requests should fire.
      let ticketsSheetRead = false;
      server.use(
        http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split("/").pop() || "");
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({ values: [["ID", "First Name", "Last Name", "Email"], ["101", "Already", "Printed", "already@example.com"]] });
          }
          if (range.includes("'tickets'") || range.includes("staff") || range.includes("sponsor")) {
            ticketsSheetRead = true;
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post("/api/production/tickets/bidder-labels")
        .set(authHeader)
        .send({ folderId: "test-folder-id", bidManagementSpreadsheetId: "test-bm-id", auctionTicketsSpreadsheetId: "test-tickets-id" });

      expect(response.status).toBe(200);
      expect(ticketsSheetRead).toBe(false);
    });

    it("returns a 400 with a real error message when the Auction Tickets spreadsheet ID is missing", async () => {
      const response = await request(app)
        .post("/api/production/tickets/bidder-labels")
        .set(authHeader)
        .send({ folderId: "test-folder-id", bidManagementSpreadsheetId: "test-bm-id" }); // no auctionTicketsSpreadsheetId

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Auction Tickets spreadsheet ID/);
      expect(appsScriptCallCount).toBe(0);
    });

    it("skips the Bidder-Numbers pre-step entirely when no bidManagementSpreadsheetId is given (existing validation still applies downstream)", async () => {
      let bidderNumbersChecked = false;
      server.use(
        http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
          const url = new URL(request.url);
          if (decodeURIComponent(url.pathname).includes("Bidder-Numbers")) bidderNumbersChecked = true;
          return HttpResponse.json({ values: [] });
        })
      );

      await request(app)
        .post("/api/production/tickets/bidder-labels")
        .set(authHeader)
        .send({ folderId: "test-folder-id" });

      expect(bidderNumbersChecked).toBe(false);
    });
  });
});