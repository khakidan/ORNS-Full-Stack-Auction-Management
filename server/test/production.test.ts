/**
 * Test suite for the Document and Presentation Creation workflows (Production).
 * Covers endpoints that interface with Google Apps Script to generate labels, 
 * slideshows, guides, catalogs, and other collateral.
 *
 * NOTE: The bulk of the tests here are dynamically generated using a `testCases.forEach` loop
 * that maps over the various document creation endpoints to produce 18 total tests.
 */
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
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

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
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/item-labels",
      funcName: "apiCreateItemLabels",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/slideshow",
      funcName: "apiCreateSlideshow",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/bidding-guide-cover",
      funcName: "apiCreateBiddingGuideCoverPage",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/bidding-guide-inner",
      funcName: "apiCreateBiddingGuideInnerPages",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/bid-sheets",
      funcName: "apiCreateBidSheets",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/catalog",
      funcName: "apiCreateCatalog",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/item-entry/table-tents",
      funcName: "apiCreateTableTents",
      payload: { folderId: "test-folder-id" },
    },
    {
      endpoint: "/api/production/tickets/bidder-labels",
      funcName: "apiCreateBidderLabels",
      payload: {},
    },
  ];

  testCases.forEach(({ endpoint, funcName, payload }) => {
    describe(endpoint, () => {
      it(`happy path - successfully calls ${funcName}`, async () => {
        const response = await request(app)
          .post(endpoint)
          .set(authHeader)
          .send(payload);

        expect(response.status).toBe(200);
        expect(productionScriptCallLog).toContain(funcName);
        expect(appsScriptCallCount).toBe(1);
        // Confirms the folderId actually reaches the Apps Script call as a
        // parameter, not just that some function got called - a payload
        // handling bug (wrong key, wrong array position) wouldn't have
        // failed this test before this assertion existed.
        expect(lastAppsScriptParams).toEqual((payload as any).folderId !== undefined ? [(payload as any).folderId] : []);
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
      .send({ folderId: "fail-folder-id" });

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
      .send({ folderId: "test-folder-id" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: "Auction-Items sheet is empty" });
  });

  it("returns 400 when the target environment's script ID isn't configured", async () => {
    const originalScriptId = process.env.SCRIPT_ID_ITEM_ENTRY;
    delete process.env.SCRIPT_ID_ITEM_ENTRY;

    const response = await request(app)
      .post("/api/production/item-entry/catalog")
      .set(authHeader)
      .send({ folderId: "test-folder-id" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Missing Target Environment Script ID" });
    expect(appsScriptCallCount).toBe(0);

    process.env.SCRIPT_ID_ITEM_ENTRY = originalScriptId;
  });
});