import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";

// Mock the googleapis module structure
const mockGetValues = vi.fn();
const mockUpdateValues = vi.fn();
const mockBatchUpdateValues = vi.fn();

vi.mock("googleapis", () => {
  return {
    google: {
      sheets: vi.fn(() => ({
        spreadsheets: {
          values: {
            get: mockGetValues,
            update: mockUpdateValues,
            batchUpdate: mockBatchUpdateValues,
          },
        },
      })),
      auth: {
        OAuth2: vi.fn(() => ({
          setCredentials: vi.fn(),
        })),
      },
    },
  };
});

// Mock the oauth utilities so that authentication verification passes immediately
vi.mock("../utils/auth", () => {
  return {
    getAuthenticatedClient: vi.fn(() => ({})),
    getOAuthClient: vi.fn(() => ({})),
  };
});

describe("bidRoutes Endpoint Suite via Supertest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires authorization and denies direct access with 401 when tokens are missing", async () => {
    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .send({
        spreadsheetId: "test-sheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("handles a successful close-and-cleanup process when authorized", async () => {
    // Intercept cookie policy or token restorer dynamically by passing a tokens header
    mockUpdateValues.mockResolvedValue({ data: {} });
    mockBatchUpdateValues.mockResolvedValue({ data: {} });

    // Bidder rows return data with: ID, First Name, Last Name, Email, Checked In (TRUE), Proxy, Checked Out (FALSE)
    mockGetValues
      // First call: Read Bidders (!A:H)
      .mockResolvedValueOnce({
        data: {
          values: [
            ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy", "Checked Out", "Paid"],
            ["1001", "Emma", "Stone", "emma@example.com", "TRUE", "FALSE", "FALSE", "FALSE"],
          ],
        },
      })
      // Second call: Read Winners (!A:ZZ)
      .mockResolvedValueOnce({
        data: {
          values: [
            ["1001", "1001_dummy"], // Emma Stone didn't win anything because no bids listed here
          ],
        },
      });

    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .set("x-google-tokens", JSON.stringify({ access_token: "mock-valid-token" }))
      .send({
        spreadsheetId: "test-sheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // Since bidder checked in but didn't win, they should get marked Checked Out & Paid (1 update)
    expect(response.body.count).toBe(1);
    
    expect(mockBatchUpdateValues).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdateValues).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: "test-sheet-id",
      requestBody: expect.objectContaining({
        data: [
          {
            range: "'Bidder-Numbers'!G2:H2",
            values: [[true, true]],
          }
        ],
        valueInputOption: "USER_ENTERED"
      })
    }));
  });

  it("handles a Google API 429 Rate Limit error gracefully via errorHandler middleware", async () => {
    // Simulate Google API rate limits throwing exceptions
    const rateLimitError: any = new Error("Quota exceeded for quota metric 'Read requests'...");
    rateLimitError.status = 429;
    mockGetValues.mockRejectedValue(rateLimitError);

    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .set("x-google-tokens", JSON.stringify({ access_token: "mock-valid-token" }))
      .send({
        spreadsheetId: "test-sheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management",
      });

    // Our global errorHandler catch intercepts errors and outputs formatted JSON responses:
    expect(response.status).toBe(500); // errorHandler falls back to standard HTTP 500 containing detail structure
    expect(response.body).toHaveProperty("message");
    expect(response.body.message).toContain("Quota exceeded for quota metric 'Read requests'");
  });
});
