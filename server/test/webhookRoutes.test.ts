/**
 * POST /api/webhooks/fluent-forms/tickets - the ticket form's Webhook feed
 * (ROADMAP W3). upsertTicketPurchase itself is covered by
 * ticketPurchaseService.test.ts; here it's a spy, to check what the route
 * hands it and when.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../services/paypalSweeperJob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/paypalSweeperJob")>()),
  getSweeperAuthClient: vi.fn(),
}));
vi.mock("../services/ticketPurchaseService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ticketPurchaseService")>()),
  upsertTicketPurchase: vi.fn(),
}));

import { app } from "../app";
import { getSweeperAuthClient } from "../services/paypalSweeperJob";
import { upsertTicketPurchase } from "../services/ticketPurchaseService";
import { getAuthenticatedClient } from "../services/oauth";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { _resetWebhookRateLimitForTesting } from "../routes/webhookRoutes";

const URL = "/api/webhooks/fluent-forms/tickets";
const SECRET = "test-webhook-secret";
const body = {
  entry_id: "1500", first_name: "Pat", last_name: "Lee", email: "pat@example.com", phone: "555-0100", tickets: "1",
  payment_method: "paypal", payment_status: "paid", payment_total: "$35.00",
};
const send = (payload: unknown = body, secret = SECRET) =>
  request(app).post(URL).set("X-ORNS-Webhook-Secret", secret).send(payload as object);

const env = { secret: process.env.FLUENT_FORMS_WEBHOOK_SECRET, mode: process.env.FLUENT_FORMS_TICKETS_MODE };

beforeEach(() => {
  process.env.FLUENT_FORMS_WEBHOOK_SECRET = SECRET;
  delete process.env.FLUENT_FORMS_TICKETS_MODE;
  _resetWebhookRateLimitForTesting();
  vi.mocked(getSweeperAuthClient).mockResolvedValue(getAuthenticatedClient({ access_token: "background", expiry_date: Date.now() + 3600000 }));
  vi.mocked(upsertTicketPurchase).mockReset().mockImplementation(async (_sheets, purchase, { mode }) =>
    mode === "write" ? { outcome: "added", entryId: purchase.entryId, rowIndex: 5 } : { outcome: "would-add", entryId: purchase.entryId, row: [] }
  );
});

afterEach(() => {
  for (const [key, value] of [["FLUENT_FORMS_WEBHOOK_SECRET", env.secret], ["FLUENT_FORMS_TICKETS_MODE", env.mode]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/webhooks/fluent-forms/tickets", () => {
  it("in shadow mode (the default) reports what it would do and writes nothing", async () => {
    const res = await send();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "compare", outcome: "would-add", entryId: "1500" });
    expect(upsertTicketPurchase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entryId: "1500", tickets: 1, total: 35 }), { mode: "compare" });
  });

  it('writes once FLUENT_FORMS_TICKETS_MODE is "write" (the switch-over)', async () => {
    process.env.FLUENT_FORMS_TICKETS_MODE = "write";

    const res = await send();

    expect(res.body).toMatchObject({ mode: "write", outcome: "added", rowIndex: 5 });
    expect(upsertTicketPurchase).toHaveBeenCalledWith(expect.anything(), expect.anything(), { mode: "write" });
  });

  it("needs no session - it's called by Fluent Forms, not a person", async () => {
    const res = await send();
    expect(res.status).toBe(200);
  });

  it("refuses a wrong or missing secret before doing anything", async () => {
    const wrong = await send(body, "guess");
    const missing = await request(app).post(URL).send(body);

    expect([wrong.status, missing.status]).toEqual([401, 401]);
    expect(upsertTicketPurchase).not.toHaveBeenCalled();
  });

  it("doesn't exist while FLUENT_FORMS_WEBHOOK_SECRET isn't set", async () => {
    delete process.env.FLUENT_FORMS_WEBHOOK_SECRET;
    const res = await send();
    expect(res.status).toBe(404);
  });

  it("refuses a body that isn't from the feed's set-up (no entry_id) with a reason Fluent Forms shows", async () => {
    const res = await send({ ...body, entry_id: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("entry_id is missing");
    expect(upsertTicketPurchase).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    const res = await send({ ...body, notes: "x".repeat(40 * 1024) });
    expect(res.status).toBe(413);
    expect(upsertTicketPurchase).not.toHaveBeenCalled();
  });

  it("stops a flood from one address", async () => {
    for (let i = 0; i < 60; i++) await send(body, "guess");
    const res = await send();
    expect(res.status).toBe(429);
  });

  it("answers 503 (so Fluent Forms logs it, and the poll adds it later) when the server has no stored Google sign-in", async () => {
    vi.mocked(getSweeperAuthClient).mockResolvedValue(null);

    const res = await send();

    expect(res.status).toBe(503);
    expect(upsertTicketPurchase).not.toHaveBeenCalled();
  });

  it("answers with an error when writing fails, so the failure shows in Fluent Forms", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(upsertTicketPurchase).mockRejectedValue(new Error("Sheets said no"));

    const res = await send();

    expect(res.status).toBeGreaterThanOrEqual(500);
    quiet.mockRestore();
  });

  it("remembers the latest delivery for the status card", async () => {
    await send();

    const stored = (await getAdminFirestore().collection("system").doc("fluentFormsTickets").get()).data();
    expect(stored?.lastWebhook).toMatchObject({ entryId: "1500", mode: "compare", outcome: "would-add", at: expect.any(String) });
  });

  it("logs what it read - numbers and labels, never a name, email or phone - even when the row already exists", async () => {
    vi.mocked(upsertTicketPurchase).mockResolvedValue({ outcome: "exists", entryId: "1500", rowIndex: 4 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let line = "";
    try {
      await send({ ...body, payment_total: "$7,000.00", guest_1_first_name: "Sam", guest_1_email: "sam@example.com" });
      line = log.mock.calls.map(([text]) => String(text)).find((text) => text.includes("fluentFormsWebhook")) || "";
    } finally {
      log.mockRestore();
    }

    expect(JSON.parse(line).fluentFormsWebhook).toEqual({
      entryId: "1500", mode: "compare", outcome: "exists",
      read: { tickets: 1, total: 7000, guests: 1, paymentMethod: "paypal", paymentStatus: "paid" },
    });
    for (const personal of ["Pat", "Lee", "pat@example.com", "555-0100", "Sam", "sam@example.com"]) expect(line).not.toContain(personal);
  });
});
