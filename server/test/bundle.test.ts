/**
 * Test suite for the Bundle workflow and Gemini Assistant features.
 * Covers bundle creation, bundle restoration, AI name/description generation, and the assistant logic.
 *
 * NOTE: The vi.mock for "../services/genai" handles two different prompt structures:
 * 1. String contents: Passed by the bundle suggestion routes.
 * 2. Array contents: Passed by the assistant route (array of message objects).
 * The mock intercepts these shapes based on whether `args.contents` is a string or not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, bundleWritePayload, updateCallCount } from "./handlers";

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
        // Default — handles assistant requests where contents is an array of message objects
        return Promise.resolve({
          text: 'AI assistant response',
          candidates: [{ finishReason: 'STOP' }]
        });
      }),
    },
  },
}));

const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

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
        if (range.includes("Value%20Calculations")) {
          return HttpResponse.json({
            values: [["Min Range", "Min Raise"], ["0", "5"]]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );
  });

  it("Happy path — two items bundled successfully", async () => {
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
    // Same bundle token
    const token = bundleWritePayload[1][10];
    expect(token).toBeTruthy();
    expect(bundleWritePayload[2][10]).toBe(token);
    expect(bundleWritePayload[3][10]).toBe(token);
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

  describe('Gemini Assistant workflow', () => {
    beforeEach(() => {
      resetHandlersState();
    });

    afterEach(() => {
      server.resetHandlers();
      resetHandlersState();
    });

    it('Happy path — returns AI response text', async () => {
      const response = await request(app)
        .post('/api/assistant')
        .set(authHeader)
        .send({
          context: 'You are an assistant for a charity auction.',
          message: 'What items are available?',
          history: []
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('text');
      expect(typeof response.body.text).toBe('string');
      expect(response.body.text.length).toBeGreaterThan(0);

      const generateContentMock = vi.mocked(
        (await import("../services/genai")).genAI.models.generateContent
      );
      expect(generateContentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              parts: expect.arrayContaining([
                expect.objectContaining({ text: 'What items are available?' })
              ])
            })
          ]),
          config: expect.objectContaining({
            systemInstruction: 'You are an assistant for a charity auction.'
          })
        })
      );
    });

    it('Includes conversation history in the request', async () => {
      const response = await request(app)
        .post('/api/assistant')
        .set(authHeader)
        .send({
          context: 'Auction context',
          message: 'Follow-up question',
          history: [
            { role: 'user', text: 'Previous question' },
            { role: 'assistant', text: 'Previous answer' }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('text');

      const generateContent = vi.mocked(
        (await import("../services/genai")).genAI.models.generateContent
      );
      expect(generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.arrayContaining([
            { role: 'user', parts: [{ text: 'Previous question' }] },
            { role: 'model', parts: [{ text: 'Previous answer' }] },
            { role: 'user', parts: [{ text: 'Follow-up question' }] }
          ])
        })
      );
    });

    it('Auth failure', async () => {
      const response = await request(app)
        .post('/api/assistant')
        .send({ message: 'Hello', history: [] });
      expect(response.status).toBe(401);
    });

    it('Missing message — returns 400', async () => {
      const response = await request(app)
        .post('/api/assistant')
        .set(authHeader)
        .send({ context: 'Some context', history: [] });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No message provided');
    });

    it('GEMINI_API_KEY not configured — returns 500', async () => {
      const originalKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const response = await request(app)
        .post('/api/assistant')
        .set(authHeader)
        .send({ message: 'Hello', history: [] });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('GEMINI_API_KEY');

      process.env.GEMINI_API_KEY = originalKey;
    });
  });
});