/**
 * Test suite for the Auction Items management workflow.
 * Covers endpoints for adding, updating, and deleting individual items,
 * as well as bulk updating items. It validates re-sequencing logic upon item deletion
 * and category changes. Also covers Settings Update endpoints.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// dataRoutes.ts's /paypal-sweeper/status and /paypal-sweeper/run-now
// routes call straight into paypalSweeperJob.ts, which reaches real
// Firestore/PayPal via firebaseAdmin.ts/paypalService.ts - mocked here at
// the module boundary so these route-level tests stay hermetic (that
// logic's own coverage lives in paypalSweeperJob.test.ts, fully mocked
// there instead). Matches auth.test.ts's existing convention for the same
// module.
const mockGetSweeperStatus = vi.fn();
const mockRunPaypalSweep = vi.fn();
vi.mock("../services/paypalSweeperJob", () => ({
  getSweeperStatus: (...args: unknown[]) => mockGetSweeperStatus(...args),
  runPaypalSweep: (...args: unknown[]) => mockRunPaypalSweep(...args),
}));

import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, lastBulkWritePayload, lastAppendedRow,
         updateCallCount, bulkWriteCallCount, appendCallCount } from "./handlers";
const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

describe("Add Auction Item workflow", () => {
  const validItemBody = {
    spreadsheetId: "test-spreadsheet-id",
    category: "Food",
    name: "Dinner for Two",
    description: "A lovely dinner for two at a local restaurant.",
    value: "$100.00",
    donor: "Jane Smith",
    itemType: "Certificate",
    idempotencyKey: crypto.randomUUID()
  };

  afterEach(() => {
    resetHandlersState();
  });

  it("handles the happy path", async () => {
    const response = await request(app)
      .post("/api/auction/add-item")
      .set(authHeader)
      .send(validItemBody);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.assigned_id).toBe("802");
    
    expect(updateCallCount).toBeGreaterThan(0);
    
    // assert on lastAppendedRow
    expect(lastAppendedRow).toBeDefined();
    expect(lastAppendedRow[0]).toBe("802"); // ID
    expect(lastAppendedRow[1]).toBe("Food"); // Category
    expect(lastAppendedRow[2]).toBe("Dinner for Two"); // Name
    expect(lastAppendedRow[5]).toBe("$45.00"); // Opening Bid (45% of 100)
    expect(lastAppendedRow[6]).toBe("$5.00"); // Min Raise ($100 falls in the "0" tier)
    expect(lastAppendedRow[9]).toBe("Active"); // Status
    expect(lastAppendedRow[10]).toBe(""); // Bundle ID
    expect(lastAppendedRow[11]).toBe(""); // Bundled Date
    expect(lastAppendedRow.length).toBe(12);
  });

  it("falls back to the same tiered min-raise ladder bundleService.ts uses when no Value Calculations tab is configured", async () => {
    // Previously itemService.ts fell back to a flat $5 here while
    // bundleService.ts fell back to a 7-tier ladder - adding a $500 item
    // and bundling items totaling $500 produced different minimum raises
    // whenever no "Value Calculations" tab existed. Both now share
    // calculateMinRaiseAmount() from utils/minRaiseHelpers.ts.
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Value Calculations")) {
          return HttpResponse.json({ values: [] }); // no tab configured
        }
        if (range.includes("Categories")) {
          return HttpResponse.json({ values: [["Category", "Base"], ["Food", "800"]] });
        }
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({ values: [["ID", "Cat", "Name", "Desc", "Val", "OB", "MR", "Don", "Type", "Status", "Bid", "Date"]] });
        }
        return HttpResponse.json({ values: [] });
      })
    );

    const response = await request(app)
      .post("/api/auction/add-item")
      .set(authHeader)
      .send({ ...validItemBody, value: "$500.00", idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(200);
    // $500 falls in the 450-600 tier of the shared hardcoded ladder -> $20.00,
    // not itemService.ts's old flat $5.00 fallback.
    expect(lastAppendedRow[6]).toBe("$20.00");
  });

  it("handles idempotency - duplicate submission", async () => {
    const key = crypto.randomUUID();
    const body = { ...validItemBody, idempotencyKey: key };
    
    const res1 = await request(app)
      .post("/api/auction/add-item")
      .set(authHeader)
      .send(body);
      
    const res2 = await request(app)
      .post("/api/auction/add-item")
      .set(authHeader)
      .send(body);

    expect(res2.status).toBe(200);
    expect(res2.body.duplicated).toBe(true);
    expect(updateCallCount).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await request(app)
      .post("/api/auction/add-item")
      .send(validItemBody);

    expect(response.status).toBe(401);
  });

  it("returns 400 for validation failure (missing name)", async () => {
    const invalidBody = { ...validItemBody, name: "" };
    const response = await request(app)
      .post("/api/auction/add-item")
      .set(authHeader)
      .send(invalidBody);

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it("returns 500 for external service failure", async () => {
    server.use(
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );
    
    const response = await request(app)
      .post("/api/auction/add-item")
      .set(authHeader)
      .send({ ...validItemBody, idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(500);
    expect(response.body.success).toBeUndefined();
  });
});

describe("Batch Update workflow — Set Category", () => {

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  it("Happy path — category update triggers re-sequencing", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
              ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
              ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""],
              ["301", "Health & Beauty", "Spa Day", "A spa day", "$100.00", "$45.00", "$5.00", "Spa", "Certificate", "Active", "", ""]
            ]
          });
        }
        if (range.includes("Categories")) {
          return HttpResponse.json({
            values: [["Category", "Base"], ["Food", "800"], ["Health & Beauty", "300"]]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );

    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send({
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2, 3], // row indices 2 and 3 correspond to the Food items (801 and 803)
        field: "category",
        value: "Travel",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.affected_categories).toContain("Food");
    expect(response.body.affected_categories).toContain("Travel");

    expect(bulkWriteCallCount).toBe(1);
    expect(lastBulkWritePayload).toBeDefined();
    
    // Index 1 corresponds to Row 2
    expect(lastBulkWritePayload[1][1]).toBe("Travel");
    expect(lastBulkWritePayload[1][0]).toBe("1101");

    // Index 2 corresponds to Row 3
    expect(lastBulkWritePayload[2][1]).toBe("Travel");
    expect(lastBulkWritePayload[2][0]).toBe("1102");

    // Index 3 (Spa Day) remains unchanged
    expect(lastBulkWritePayload[3][0]).toBe("301");
    expect(lastBulkWritePayload[3][1]).toBe("Health & Beauty");
  });

  it("Category update — idempotency", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
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
        return HttpResponse.json({ values: [] });
      })
    );

    const idempotencyKey = crypto.randomUUID();
    const payload = {
      spreadsheetId: "test-spreadsheet-id",
      rowIndices: [2, 3],
      field: "category",
      value: "Travel",
      idempotencyKey
    };

    const res1 = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send(payload);

    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.duplicated).toBe(true);
    expect(bulkWriteCallCount).toBe(1); // The sheet was not written twice
  });

  it("Category update — auth failure", async () => {
    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .send({
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2, 3],
        field: "category",
        value: "Travel",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
  });

  it("Category update — validation failure", async () => {
    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send({
        spreadsheetId: "test-spreadsheet-id",
        field: "category",
        value: "Travel",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Missing required bulk update parameters");
  });

  it("Category update — external service failure", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send({
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2, 3],
        field: "category",
        value: "Travel",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(500);
  });
});

describe("Batch Update workflow — Set Type", () => {

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  it("Happy path — type update does NOT trigger re-sequencing", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
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
        return HttpResponse.json({ values: [] });
      })
    );

    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send({
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2, 3],
        field: "itemType",
        value: "Physical",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.affected_categories).toEqual([]);

    expect(bulkWriteCallCount).toBe(1);
    expect(lastBulkWritePayload).toBeDefined();

    expect(lastBulkWritePayload[1][8]).toBe("Physical");
    expect(lastBulkWritePayload[2][8]).toBe("Physical");

    expect(lastBulkWritePayload[1][0]).toBe("801");
    expect(lastBulkWritePayload[2][0]).toBe("803");
  });

  it("Type update — idempotency", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
              ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""]
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

    const idempotencyKey = crypto.randomUUID();
    const payload = {
      spreadsheetId: "test-spreadsheet-id",
      rowIndices: [2],
      field: "itemType",
      value: "Physical",
      idempotencyKey
    };

    const res1 = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send(payload);

    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.duplicated).toBe(true);
    expect(bulkWriteCallCount).toBe(1);
  });

  it("Type update — auth failure", async () => {
    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .send({
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2],
        field: "itemType",
        value: "Physical",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
  });

  it("Type update — validation failure", async () => {
    const response = await request(app)
      .post("/api/auction/bulk-update-items")
      .set(authHeader)
      .send({
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [],
        field: "itemType",
        value: "Physical",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(400);
  });
});

describe("Update Auction Item workflow", () => {
  const spreadsheetId = "test-spreadsheet-id";
  // We already have authHeader in the outer scope of workflows.test.ts! It is defined on line 30.
  // I can just reuse it and not define it here, so I'll remove it.

  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(() => {
    server.resetHandlers();
    resetHandlersState();
  });

  const ITEM_FIELD_MAPPING = {
    category: 1,
    name: 2,
    description: 3,
    value: 4,
    openingBid: 5,
    minRaise: 6,
    donor: 7,
    itemType: 8,
    status: 9
  };

  Object.entries(ITEM_FIELD_MAPPING).forEach(([field, colIdx]) => {
    it(`updates the ${field} field successfully`, async () => {
      const response = await request(app)
        .post("/api/auction/update-item")
        .set(authHeader)
        .send({
          spreadsheetId,
          rowIndex: 2,
          field,
          value: "Test Value"
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(lastBulkWritePayload).toBeDefined();
      // Check if value is at correct colIdx for row 2 (which is index 1)
      expect(lastBulkWritePayload[1][colIdx]).toBe("Test Value");
    });
  });

  it("auth failure test", async () => {
    const response = await request(app)
      .post("/api/auction/update-item")
      .send({
        spreadsheetId,
        rowIndex: 2,
        field: "name",
        value: "Test Value"
      });

    expect(response.status).toBe(401);
  });

  it("missing required fields test", async () => {
    const response = await request(app)
      .post("/api/auction/update-item")
      .set(authHeader)
      .send({
        spreadsheetId,
        // Missing rowIndex
        field: "name",
        value: "Test Value"
      });

    expect(response.status).toBe(400);
  });

  it("invalid field name test", async () => {
    const response = await request(app)
      .post("/api/auction/update-item")
      .set(authHeader)
      .send({
        spreadsheetId,
        rowIndex: 2,
        field: "nonExistentField",
        value: "Test"
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it("category change triggers re-sequencing test", async () => {
    const response = await request(app)
      .post("/api/auction/update-item")
      .set(authHeader)
      .send({
        spreadsheetId,
        rowIndex: 2,
        field: "category",
        value: "Travel"
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lastBulkWritePayload).toBeDefined();
    
    // Changed to Travel, so ID should be exactly 1101 (since base is 1100 and it's the 1st travel item)
    // ID is at index 0
    expect(lastBulkWritePayload[1][0]).toBe("1101");
  });
});

describe("Delete Auction Item workflow", () => {
  const spreadsheetId = "test-spreadsheet-id";

  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(() => {
    server.resetHandlers();
    resetHandlersState();
  });

  it("Happy path — delete marks item correctly", async () => {
    const response = await request(app)
      .post("/api/auction/delete-item")
      .set(authHeader)
      .send({ spreadsheetId, rowIndex: 2 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    expect(lastBulkWritePayload).toBeDefined();

    const updatedRow = lastBulkWritePayload[1];
    expect(updatedRow[0]).toBe("");
    expect(updatedRow[9]).toBe("Deleted");
  });

  it("Auth failure", async () => {
    const response = await request(app)
      .post("/api/auction/delete-item")
      .send({ spreadsheetId, rowIndex: 2 });
    expect(response.status).toBe(401);
  });

  it("Missing required fields", async () => {
    const response = await request(app)
      .post("/api/auction/delete-item")
      .set(authHeader)
      .send({ spreadsheetId });

    expect(response.status).toBe(400);
  });

  // Regression guard for the hardening audit's finding: this route had no
  // idempotencyKey, unlike its add-item/bulk-update-items siblings. See
  // docs/agents/refactor-opportunities.md's Code Hardening item #1 /
  // CHANGELOG.md.
  it("returns cached response for a duplicate idempotency key instead of deleting twice", async () => {
    const key = "delete-dup-key";

    const first = await request(app)
      .post("/api/auction/delete-item")
      .set(authHeader)
      .send({ spreadsheetId, rowIndex: 2, idempotencyKey: key });
    expect(first.status).toBe(200);
    expect(first.body.duplicated).toBeUndefined();

    const second = await request(app)
      .post("/api/auction/delete-item")
      .set(authHeader)
      .send({ spreadsheetId, rowIndex: 2, idempotencyKey: key });
    expect(second.status).toBe(200);
    expect(second.body.duplicated).toBe(true);
  });

  it("Re-sequencing after delete", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);

        if (pathname.includes("Categories!A:C") || pathname.includes("Categories")) {
          return HttpResponse.json({
            values: [
              ["Category", "Base"],
              ["Food", "800"]
            ]
          });
        }

        if (pathname.includes("Auction-Items")) {
          return HttpResponse.json({
            values: [
              ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Type", "Status", "Bundle ID", "Bundled Date/Time"],
              ["800", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
              ["801", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""],
              ["802", "Food", "Pasta Night", "A pasta dinner", "$60.00", "$25.00", "$5.00", "Pasta Place", "Certificate", "Active", "", ""]
            ]
          });
        }

        return HttpResponse.json({ values: [] });
      })
    );

    const response = await request(app)
      .post("/api/auction/delete-item")
      .set(authHeader)
      .send({ spreadsheetId, rowIndex: 3 });

    expect(response.status).toBe(200);

    expect(lastBulkWritePayload).toBeDefined();
    
    const values = lastBulkWritePayload;
    expect(values[1][0]).toBe("800"); 
    expect(values[2][0]).toBe(""); 
    expect(values[3][0]).toBe("801"); 
  });

  describe('Settings Update workflow', () => {
    const spreadsheetId = 'test-settings-id';

    beforeEach(() => {
      resetHandlersState();
    });

    afterEach(() => {
      server.resetHandlers();
      resetHandlersState();
    });

    it('Happy path — updates an existing key', async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          if (url.pathname.includes('_Settings')) {
            return HttpResponse.json({
              values: [
                ['ticketPrice', '35', 'Price per ticket'],
                ['auctionYear', '2025', 'Current auction year']
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId, key: 'ticketPrice', value: '40', description: 'Updated price' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(updateCallCount).toBe(1);
      expect(appendCallCount).toBe(0);
    });

    it('Happy path — appends a new key that does not yet exist', async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          if (url.pathname.includes('_Settings')) {
            return HttpResponse.json({
              values: [
                ['ticketPrice', '35', 'Price per ticket']
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId, key: 'newSetting', value: 'newValue' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(appendCallCount).toBe(1);
      expect(updateCallCount).toBe(0);
    });

    it('Auth failure', async () => {
      const response = await request(app)
        .post('/api/settings/update')
        .send({ spreadsheetId, key: 'ticketPrice', value: '40' });
      expect(response.status).toBe(401);
    });

    it('Missing required fields — no key', async () => {
      const response = await request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId });
      expect(response.status).toBe(400);
    });

    it('Missing required fields — no spreadsheetId', async () => {
      const response = await request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ key: 'ticketPrice', value: '40' });
      expect(response.status).toBe(400);
    });

    // Regression guard for the hardening audit's finding: this route had
    // neither withLock nor an idempotency key, unlike sibling mutating
    // routes. See docs/agents/refactor-opportunities.md's Code Hardening
    // item #1 / CHANGELOG.md.
    it('returns cached response for a duplicate idempotency key instead of writing twice', async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          if (url.pathname.includes('_Settings')) {
            return HttpResponse.json({ values: [['ticketPrice', '35', 'Price per ticket']] });
          }
          return HttpResponse.json({ values: [] });
        })
      );
      const key = 'settings-dup-key';

      const first = await request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId, key: 'ticketPrice', value: '40', idempotencyKey: key });
      expect(first.status).toBe(200);
      expect(first.body.duplicated).toBeUndefined();
      expect(updateCallCount).toBe(1);

      const second = await request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId, key: 'ticketPrice', value: '40', idempotencyKey: key });
      expect(second.status).toBe(200);
      expect(second.body.duplicated).toBe(true);
      // The second, duplicate request must never re-hit the Sheets API.
      expect(updateCallCount).toBe(1);
    });

    it('does not start a second concurrent settings/update read (same spreadsheet) until the first has fully finished writing', async () => {
      const callOrder: string[] = [];
      let releaseFirst: () => void;
      const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

      let readCount = 0;
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ request }) => {
          const url = new URL(request.url);
          if (url.pathname.includes('_Settings')) {
            readCount++;
            const isFirst = readCount === 1;
            callOrder.push(isFirst ? 'A-start' : 'B-start');
            if (isFirst) await firstGate;
            return HttpResponse.json({ values: [['ticketPrice', '35', 'Price per ticket']] });
          }
          return HttpResponse.json({ values: [] });
        }),
        http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          if (decodeURIComponent(url.pathname).includes('_Settings')) {
            callOrder.push(readCount === 1 ? 'A-end' : 'B-end');
          }
          return HttpResponse.json({ updatedRows: 1 });
        })
      );

      const rawRequestA = request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId, key: 'ticketPrice', value: '40', idempotencyKey: 'lock-key-a' });
      const rawRequestB = request(app)
        .post('/api/settings/update')
        .set(authHeader)
        .send({ spreadsheetId, key: 'ticketPrice', value: '50', idempotencyKey: 'lock-key-b' });

      // supertest's Test object is a *lazy* thenable - it doesn't actually
      // dispatch the HTTP request until something awaits/calls .then() on
      // it. Wrapping each in its own immediately-invoked async function
      // forces dispatch to happen NOW (both requests genuinely in flight
      // concurrently), rather than only once Promise.all below consumes
      // them - which would otherwise dispatch A, let it fully resolve, and
      // only then dispatch B, silently defeating this entire test.
      const requestA = (async () => await rawRequestA)();
      const requestB = (async () => await rawRequestB)();

      // Fired both without awaiting either yet. Give both a moment to
      // actually reach the mocked read, then release A.
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseFirst!();

      const [responseA, responseB] = await Promise.all([requestA, requestB]);

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);
      // With the lock: B can't even start its own read until A fully
      // finishes writing. Without it: B (ungated) would read the same
      // stale row A read, and both writes would target the same row
      // independently rather than being serialized.
      expect(callOrder).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
    });
  });
});

// Drives the Configuration page's PayPal sweeper status card - see
// docs/agents/refactor-opportunities.md's Code Hardening item #2 and
// CHANGELOG.md.
describe("PayPal Sweeper status routes", () => {
  beforeEach(() => {
    mockGetSweeperStatus.mockReset();
    mockRunPaypalSweep.mockReset();
  });

  it("GET /paypal-sweeper/status returns the service's status object", async () => {
    const status = {
      credentialConfigured: true,
      credentialUpdatedBy: "staff@orns.org",
      credentialUpdatedAt: "2026-01-01T00:00:00.000Z",
      intervalMinutes: 5,
      scheduleRunning: true,
      lastRunAt: "2026-01-01T00:05:00.000Z",
      lastResult: { pending: 1, resolved: 1, escalated: 0 },
      nextRunAt: "2026-01-01T00:10:00.000Z",
    };
    mockGetSweeperStatus.mockResolvedValue(status);

    const response = await request(app).get("/api/paypal-sweeper/status").set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(status);
  });

  it("GET /paypal-sweeper/status requires auth", async () => {
    const response = await request(app).get("/api/paypal-sweeper/status");
    expect(response.status).toBe(401);
    expect(mockGetSweeperStatus).not.toHaveBeenCalled();
  });

  it("POST /paypal-sweeper/run-now triggers an immediate sweep and returns its outcome", async () => {
    mockRunPaypalSweep.mockResolvedValue({ pending: 2, resolved: 1, escalated: 1 });

    const response = await request(app).post("/api/paypal-sweeper/run-now").set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ pending: 2, resolved: 1, escalated: 1 });
    expect(mockRunPaypalSweep).toHaveBeenCalledTimes(1);
  });

  it("POST /paypal-sweeper/run-now requires auth", async () => {
    const response = await request(app).post("/api/paypal-sweeper/run-now");
    expect(response.status).toBe(401);
    expect(mockRunPaypalSweep).not.toHaveBeenCalled();
  });

  it("forwards a thrown error from the status check to the error handler", async () => {
    mockGetSweeperStatus.mockRejectedValue(new Error("Firestore unavailable"));

    const response = await request(app).get("/api/paypal-sweeper/status").set(authHeader);

    expect(response.status).toBe(500);
  });
});