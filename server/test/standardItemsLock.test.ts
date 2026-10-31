/**
 * Only an Administrator may edit, delete, bulk-edit or bundle a standard
 * item (src/lib/standardItems.ts); anyone else gets 403 before anything
 * is written. Ordinary items are unaffected.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { app } from "../app";
import { server } from "./setup";
import { authCookieHeader } from "./helpers/session";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { resetHandlersState, updateCallCount, bulkWriteCallCount } from "./handlers";

const tokens = { access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 };
const asUser = authCookieHeader(tokens, "helper@orns.org");
const asAdmin = authCookieHeader(tokens);
const REFUSAL = /Only an Administrator can change the standard items/;

// Row 2 an ordinary item, row 3 a standard one, row 4 a standard one an Administrator renamed.
const ITEMS = [
  ["Item Number", "Category", "Name"],
  ["101", "Food", "Dinner for Two"],
  ["1501", "Raffle Tickets", "One Raffle Ticket for a $500 Amazon Gift Card"],
  ["1601", "Open Appeal", "Paddle Raise $500"],
];

beforeEach(async () => {
  await getAdminFirestore().collection("userRoles").doc("helper@orns.org").set({ role: "user" });
  server.use(http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
    if (decodeURIComponent(String(params.range)) === "'Auction-Items'!A:C") return HttpResponse.json({ values: ITEMS });
    return undefined;
  }));
});
afterEach(() => resetHandlersState());

describe("standard items: Administrators only", () => {
  it("refuses someone else deleting or editing one, by name or by ID and category, before writing", async () => {
    const del = await request(app).post("/api/auction/delete-item").set(asUser).send({ spreadsheetId: "s", rowIndex: 3, idempotencyKey: crypto.randomUUID() });
    expect(del.status).toBe(403);
    expect(del.body.error).toMatch(REFUSAL);

    const edit = await request(app).post("/api/auction/update-item").set(asUser).send({ spreadsheetId: "s", rowIndex: 4, changes: { name: "x" } });
    expect(edit.status).toBe(403);

    const bulk = await request(app).post("/api/auction/bulk-update-items").set(asUser).send({ spreadsheetId: "s", rowIndices: [2, 3], field: "itemType", value: "Certificate", idempotencyKey: crypto.randomUUID() });
    expect(bulk.status).toBe(403);

    const bundle = await request(app).post("/api/bundle/process").set(asUser).send({
      spreadsheetId: "s", targetIds: ["101", "1501"], newName: "B", newDescription: "", targetCategory: "Food", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", bundleEventToken: "t", idempotencyKey: crypto.randomUUID(),
    });
    expect(bundle.status).toBe(403);

    expect(updateCallCount).toBe(0);
    expect(bulkWriteCallCount).toBe(0);
  });

  it("lets them change an ordinary item", async () => {
    const res = await request(app).post("/api/auction/update-item").set(asUser).send({ spreadsheetId: "s", rowIndex: 2, changes: { name: "Dinner for Four" } });
    expect(res.status).not.toBe(403);
  });

  it("lets an Administrator change a standard item", async () => {
    const res = await request(app).post("/api/auction/update-item").set(asAdmin).send({ spreadsheetId: "s", rowIndex: 3, changes: { donor: "ORNS" } });
    expect(res.status).not.toBe(403);
  });
});
