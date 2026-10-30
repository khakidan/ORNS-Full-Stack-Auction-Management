/**
 * Test suite for the Bundle workflow.
 * Covers bundle creation, bundle restoration, and AI name/description generation.
 *
 * NOTE: The vi.mock for "../services/genai" intercepts the bundle suggestion
 * routes' string-shaped `contents` prompt, keyed off its prefix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, bundleWritePayload, updateCallCount } from "./handlers";
import { authCookieHeader } from "./helpers/session";
import { logAction } from "../services/actionLog";
import { changesSince } from "../utils/changeFeed";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};

vi.mock("../services/genai", () => ({
  genAI: {
    models: {
      generateContent: vi.fn().mockImplementation((args) => {
        const contentsStr = typeof args.contents === 'string' ? args.contents : '';
        if (contentsStr.startsWith("Suggested names")) {
          return Promise.resolve({
            text: '["Name 1", "Name 2", "Name 3"]',
            candidates: [{ finishReason: 'STOP' }]
          });
        } else if (contentsStr.startsWith("Write a professional")) {
          return Promise.resolve({
            text: 'Description text',
            candidates: [{ finishReason: 'STOP' }]
          });
        }
        // Default fallback for any other prompt shape
        return Promise.resolve({
          text: 'AI response',
          candidates: [{ finishReason: 'STOP' }]
        });
      }),
    },
  },
}));

const authHeader = authCookieHeader(mockTokens);

describe('Bundle Creation workflow', () => {
  const validProcessBody = {
    spreadsheetId: "ss-id",
    targetIds: ["801", "803"],
    newName: "Test Bundle",
    targetCategory: "Food",
    value: "200",
    openingBid: "90",
    minRaise: "20",
    donor: "Donor",
    itemType: "Auction"
  };

  beforeEach(() => {
    resetHandlersState();
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["ID", "Cat", "Name", "Desc", "Val", "OB", "MR", "Don", "Type", "Status", "Bid", "Date"],
              ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
              ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""]
            ]
          });
        }
        if (range.includes("Categories")) {
          return HttpResponse.json({
            values: [["Category", "Base"], ["Food", "800"]]
          });
        }
        if (range.includes("Value Calculations")) {
          return HttpResponse.json({
            values: [["Min Range", "Min Raise"], ["0", "5"]]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );
  });

  it("Happy path — two items bundled successfully", async () => {
    const version = changesSince(0).version;
    const response = await request(app)
      .post("/api/bundle/process")
      .set(authHeader)
      .send({ ...validProcessBody, idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ action_executed: "BUNDLE_ITEMS" }));
    expect(response.body.ui_history_log.bundle_item_name).toBe("Test Bundle");
    expect(response.body.ui_history_log.original_item_names).toEqual(expect.arrayContaining(["Pizza Night", "Sushi Dinner"]));
    
    expect(bundleWritePayload).toHaveLength(4);
    // Original items inactive
    expect(bundleWritePayload[1][0]).toBe("");
    expect(bundleWritePayload[1][9]).toBe("Inactive");
    expect(bundleWritePayload[2][0]).toBe("");
    expect(bundleWritePayload[2][9]).toBe("Inactive");
    // New item active
    expect(bundleWritePayload[3][0]).toBe("800");
    expect(bundleWritePayload[3][9]).toBe("Active");
    expect(bundleWritePayload[3][2]).toBe("Test Bundle");
    expect(bundleWritePayload[3][1]).toBe("Food");
    // Manually-entered value/openingBid/minRaise/donor/itemType are respected
    // as-is, not silently recomputed from the item data or tier table.
    expect(bundleWritePayload[3][4]).toBe("$200.00");
    expect(bundleWritePayload[3][5]).toBe("90");
    expect(bundleWritePayload[3][6]).toBe("20");
    expect(bundleWritePayload[3][7]).toBe("Donor");
    expect(bundleWritePayload[3][8]).toBe("Auction");
    // Same bundle token
    const token = bundleWritePayload[1][10];
    expect(token).toBeTruthy();
    expect(bundleWritePayload[2][10]).toBe(token);
    expect(bundleWritePayload[3][10]).toBe(token);

    const items = response.body.ui_history_log.original_item_names;
    expect(logAction).toHaveBeenCalledWith(expect.anything(), {
      area: "Auction Items",
      action: "Bundle items",
      target: "Test Bundle",
      summary: `Bundled 2 item(s) into "Test Bundle": ${items.join(", ")}`,
      after: { bundleId: token, items },
      location: "Auction Items 'Auction-Items'",
      undo: { kind: "bundle", spreadsheetId: "ss-id", bundleToken: token, bundleName: "Test Bundle" },
    });
    expect(changesSince(version).changed).toContain("ss-id");
  });

  it("falls back to the Value-Calculations tier table only when minRaise isn't provided", async () => {
    const { minRaise, ...bodyWithoutMinRaise } = validProcessBody;

    const response = await request(app)
      .post("/api/bundle/process")
      .set(authHeader)
      .send({ ...bodyWithoutMinRaise, idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(200);
    // The mocked "Value Calculations" sheet has one tier: min range 0 -> $5.00.
    expect(bundleWritePayload[3][6]).toBe("$5.00");
  });

  it("Idempotency — duplicate bundle submission", async () => {
    const key = crypto.randomUUID();
    await request(app).post("/api/bundle/process").set(authHeader).send({ ...validProcessBody, idempotencyKey: key });
    const response = await request(app).post("/api/bundle/process").set(authHeader).send({ ...validProcessBody, idempotencyKey: key });
    expect(response.body.duplicated).toBe(true);
    expect(updateCallCount).toBe(1);
  });

  it("Auth failure", async () => {
    const response = await request(app).post("/api/bundle/process").send({ ...validProcessBody, idempotencyKey: crypto.randomUUID() });
    expect(response.status).toBe(401);
  });

  it("Validation failure — empty targetIds", async () => {
    const response = await request(app).post("/api/bundle/process").set(authHeader).send({ ...validProcessBody, targetIds: [], idempotencyKey: crypto.randomUUID() });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it("AI name suggestions — happy path", async () => {
    const response = await request(app).post("/api/bundle/suggest-names").set(authHeader).send({
      items: [{ name: "Pizza Night" }, { name: "Sushi Dinner" }]
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.suggestions)).toBe(true);
    expect(response.body.suggestions.length).toBeGreaterThan(0);

    const generateContentMock = vi.mocked(
      (await import("../services/genai")).genAI.models.generateContent
    );
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining("Pizza Night"),
      })
    );
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining("Sushi Dinner"),
      })
    );
  });

  it("AI name suggestions — auth failure", async () => {
    const response = await request(app).post("/api/bundle/suggest-names").send({});
    expect(response.status).toBe(401);
  });

  it("AI name suggestions — empty items array", async () => {
    const response = await request(app).post("/api/bundle/suggest-names").set(authHeader).send({ items: [] });
    expect(response.status).toBe(400);
  });

  it("AI description suggestion — happy path", async () => {
    const response = await request(app).post("/api/bundle/suggest-description").set(authHeader).send({
      items: [{ name: "Pizza Night", description: "A pizza dinner" }, { name: "Sushi Dinner", description: "A sushi dinner" }]
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("description");
    expect(typeof response.body.description).toBe("string");
    expect(response.body.description.length).toBeGreaterThan(0);

    const generateContentMock = vi.mocked(
      (await import("../services/genai")).genAI.models.generateContent
    );
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining("Pizza Night"),
      })
    );
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining("A pizza dinner"),
      })
    );
  });

  it("AI description suggestion — auth failure", async () => {
    const response = await request(app).post("/api/bundle/suggest-description").send({
      items: [{ name: "Pizza Night", description: "A pizza dinner" }, { name: "Sushi Dinner", description: "A sushi dinner" }]
    });
    expect(response.status).toBe(401);
  });

  it("AI description suggestion — empty items array", async () => {
    const response = await request(app).post("/api/bundle/suggest-description").set(authHeader).send({ items: [] });
    expect(response.status).toBe(400);
  });
});

describe('Bundle Restore workflow', () => {
  beforeEach(() => {
    resetHandlersState();
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["ID", "Cat", "Name", "Desc", "Val", "OB", "MR", "Don", "Type", "Status", "Bid", "Date"],
              ["801", "Food", "Test Bundle", "Desc", "$200.00", "$90.00", "$20.00", "Donor", "Auction", "Active", "BND-TEST-001", ""],
              ["", "Food", "Pizza Night", "Desc", "$50.00", "$22.50", "$5.00", "Joe", "Cert", "Inactive", "BND-TEST-001", "123"],
              ["", "Food", "Sushi Dinner", "Desc", "$150.00", "$67.50", "$10.00", "Sushi", "Cert", "Inactive", "BND-TEST-001", "123"]
            ]
          });
        }
        if (range.includes("Categories")) {
          return HttpResponse.json({
            values: [["Category", "Base"], ["Food", "800"]]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );
  });

  it("Happy path — bundle restored successfully", async () => {
    const version = changesSince(0).version;
    const response = await request(app)
      .post("/api/bundle/restore")
      .set(authHeader)
      .send({
        spreadsheetId: "ss-id",
        targetBundleToken: "BND-TEST-001",
        idempotencyKey: crypto.randomUUID()
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.ui_history_log.original_item_names).toEqual(expect.arrayContaining(["Pizza Night", "Sushi Dinner"]));
    
    expect(bundleWritePayload).toHaveLength(4);
    // Bundle inactive
    expect(bundleWritePayload[1][0]).toBe("");
    expect(bundleWritePayload[1][9]).toBe("Inactive");
    expect(bundleWritePayload[1][10]).toBe("");
    // Original items active and re-sequenced
    expect(bundleWritePayload[2][0]).toBe("800");
    expect(bundleWritePayload[2][9]).toBe("Active");
    expect(bundleWritePayload[2][10]).toBe("");
    expect(bundleWritePayload[3][0]).toBe("801");
    expect(bundleWritePayload[3][9]).toBe("Active");
    expect(bundleWritePayload[3][10]).toBe("");

    expect(logAction).toHaveBeenCalledWith(expect.anything(), {
      area: "Auction Items",
      action: "Restore bundle",
      target: "BND-TEST-001",
      summary: "Split bundle BND-TEST-001 back into its original items",
      notUndoableReason: "re-bundle the items instead",
    });
    expect(changesSince(version).changed).toContain("ss-id");
  });

  it("Idempotency — duplicate restore", async () => {
    const key = crypto.randomUUID();
    await request(app).post("/api/bundle/restore").set(authHeader).send({ spreadsheetId: "ss-id", targetBundleToken: "BND-TEST-001", idempotencyKey: key });
    const response = await request(app).post("/api/bundle/restore").set(authHeader).send({ spreadsheetId: "ss-id", targetBundleToken: "BND-TEST-001", idempotencyKey: key });
    expect(response.body.duplicated).toBe(true);
    expect(updateCallCount).toBe(1);
  });

  it("Bundle not found", async () => {
    const response = await request(app).post("/api/bundle/restore").set(authHeader).send({
      spreadsheetId: "ss-id",
      targetBundleToken: "NON-EXISTENT-TOKEN",
      idempotencyKey: crypto.randomUUID()
    });
    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
  });

  it("Auth failure", async () => {
    const response = await request(app).post("/api/bundle/restore").send({});
    expect(response.status).toBe(401);
  });
});