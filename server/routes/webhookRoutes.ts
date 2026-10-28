import { Router } from "express";
import { google } from "googleapis";
import { getSweeperAuthClient } from "../services/paypalSweeperJob";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { fluentFormsApiFromEnv } from "../services/fluentFormsApi";
import { checkTicketPayment, paypalForTickets } from "../services/ticketPaymentCheck";
import { purchaseFromWebhook } from "../services/fluentFormsWebhookPayload";
import { TicketPurchase } from "../services/ticketPurchaseRow";
import { ticketWriteMode, upsertTicketPurchase } from "../services/ticketPurchaseService";
import { secretMatches } from "../utils/sharedSecret";

/** Largest body accepted; the form's selected fields are well under 2 KB. */
const MAX_BODY_BYTES = 32 * 1024;

// Requests per IP per window - Fluent Forms sends one per purchase (and
// one per payment change), so this only stops a flood. In-process, like
// the app's other limits (one Cloud Run instance).
const LIMIT = 60;
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number[]>();

function allowRequest(ip: string, now = Date.now()): boolean {
  const times = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= LIMIT) {
    recent.set(ip, times);
    return false;
  }
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 10_000) recent.clear();
  return true;
}

/** Test-only. */
export function _resetWebhookRateLimitForTesting(): void {
  recent.clear();
}

/**
 * What the app read from a delivery - numbers and labels only, never a
 * name, email or phone - so a test shows the parsed values in Cloud
 * Logging whatever the outcome (an "exists" never builds the row): a
 * Payment Total sent in cents would show here as 7000, not 70.
 */
function whatWasRead(purchase: TicketPurchase) {
  return {
    tickets: purchase.tickets,
    total: purchase.total,
    guests: purchase.guests.filter((g) => g.firstName || g.lastName || g.email).length,
    paymentMethod: purchase.paymentMethod,
    paymentStatus: purchase.paymentStatus,
  };
}

/**
 * After the row is handled: confirm its payment from Fluent Forms' REST API
 * and PayPal (W4). The delivery only says *when* to look - what it says
 * about the payment isn't trusted. Never fails the request: the row was
 * handled, and the poll (W5) checks a row still Pending again.
 */
async function checkPayment(sheets: ReturnType<typeof google.sheets>, entryId: string, mode: "write" | "compare") {
  const fluentForms = fluentFormsApiFromEnv();
  if (!fluentForms) return { outcome: "not-configured" };
  try {
    return await checkTicketPayment(sheets, entryId, { mode, fluentForms, paypal: await paypalForTickets() });
  } catch (error: any) {
    console.error("[FluentFormsWebhook] Payment check failed:", error?.message || error);
    return { outcome: "error", error: String(error?.message || error).slice(0, 500) };
  }
}

/**
 * Remembers the latest delivery for the Tickets page's status card (W6),
 * and logs it to Cloud Logging (`jsonPayload.fluentFormsWebhook`), which
 * is how shadow mode is checked until that card exists. Never fails the
 * request.
 */
async function recordDelivery(entry: Record<string, unknown>): Promise<void> {
  console.log(JSON.stringify({ fluentFormsWebhook: entry }));
  try {
    await getAdminFirestore().collection("system").doc("fluentFormsTickets").set({ lastWebhook: { ...entry, at: new Date().toISOString() } }, { merge: true });
  } catch (err: any) {
    console.warn("[FluentFormsWebhook] Couldn't record the delivery:", err?.message || err);
  }
}

/**
 * Endpoints called by other services, not people - so no session. Mounted
 * at /api/webhooks.
 *
 * POST /fluent-forms/tickets (ROADMAP W3): the "Auction Tickets" form's
 * Webhook feed, sent on each purchase and payment change. The body is the
 * selected fields in fluentFormsWebhookPayload.ts; it must carry the
 * FLUENT_FORMS_WEBHOOK_SECRET env var's value in an `X-ORNS-Webhook-Secret`
 * header (set in the feed's request headers). With the env var unset the
 * endpoint doesn't exist.
 *
 * The purchase goes to upsertTicketPurchase (W2) in the mode from
 * FLUENT_FORMS_TICKETS_MODE: "compare" (the default) writes nothing,
 * "write" adds the row; then checkTicketPayment (W4) confirms a PayPal
 * payment from the payment itself. It runs as the server's stored background Google
 * sign-in, since no person is asking. A failure answers 5xx, so Fluent
 * Forms logs it against the entry - and the poll (W5) adds it later.
 */
export default function createWebhookRouter() {
  const router = Router();

  router.post("/fluent-forms/tickets", async (req, res, next) => {
    const expected = process.env.FLUENT_FORMS_WEBHOOK_SECRET?.trim();
    if (!expected) return res.status(404).end();
    if (!allowRequest(req.ip || "unknown")) return res.status(429).json({ error: "Too many requests." });
    if (!secretMatches(req.get("X-ORNS-Webhook-Secret"), expected)) {
      return res.status(401).json({ error: "Invalid webhook secret" });
    }
    if (Number(req.get("content-length") || 0) > MAX_BODY_BYTES) return res.status(413).json({ error: "The request body is too large." });

    const purchase = purchaseFromWebhook(req.body);
    if ("error" in purchase) return res.status(400).json({ error: purchase.error });

    const mode = ticketWriteMode();
    try {
      const client = await getSweeperAuthClient();
      if (!client) {
        await recordDelivery({ entryId: purchase.entryId, mode, outcome: "no-google-sign-in", read: whatWasRead(purchase) });
        return res.status(503).json({ error: "The server has no stored Google sign-in to write with. A staff member needs to sign in to the app once." });
      }
      const sheets = google.sheets({ version: "v4", auth: client });
      const result = await upsertTicketPurchase(sheets, purchase, { mode });
      const payment = result.outcome === "added" || result.outcome === "exists" ? await checkPayment(sheets, result.entryId, mode) : undefined;
      await recordDelivery({
        entryId: result.entryId, mode, outcome: result.outcome, read: whatWasRead(purchase),
        ...("problems" in result ? { problems: result.problems } : {}),
        ...(payment ? { payment } : {}),
      });
      res.json({ mode, ...result, ...(payment ? { payment } : {}) });
    } catch (error: any) {
      await recordDelivery({ entryId: purchase.entryId, mode, outcome: "error", read: whatWasRead(purchase), error: String(error?.message || error).slice(0, 500) });
      next(error);
    }
  });

  return router;
}
