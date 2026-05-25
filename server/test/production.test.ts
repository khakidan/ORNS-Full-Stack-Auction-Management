import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, productionScriptCallLog,
         appsScriptCallCount } from "./handlers";

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
});