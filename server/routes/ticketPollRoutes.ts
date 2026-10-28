import { Router, Request, Response, NextFunction } from "express";
import { requirePermission } from "../middleware/requirePermission";
import { logAction } from "../services/actionLog";
import { fluentFormsApiFromEnv } from "../services/fluentFormsApi";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { pollTicketPurchasesNow, readTicketPollStatus } from "../services/ticketPoll";
import { listReview, ticketWriteMode } from "../services/ticketPurchaseService";
import { AlreadyRunningError } from "../utils/asyncLock";

/**
 * "Check now" for the website ticket poll (ROADMAP W5): the same run Cloud
 * Scheduler makes a few times a day, on demand. Each row it adds or
 * payment it confirms is in Action History as "Fluent Forms (website)";
 * this records who asked for the run.
 */
export default function createTicketPollRouter() {
  const router = Router();

  /**
   * The Tickets page's status card (ROADMAP W6): the last webhook, the
   * poll's last runs, the entries the poll had to add, and the review
   * list - so a failure shows up days before the auction, not at check-in.
   */
  router.get("/tickets/fluent-forms/status", requirePermission("auction.stage"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [webhookDoc, poll, review] = await Promise.all([
        getAdminFirestore().collection("system").doc("fluentFormsTickets").get(),
        readTicketPollStatus(),
        listReview(),
      ]);
      const webhook = webhookDoc.data()?.lastWebhook;
      res.json({
        configured: fluentFormsApiFromEnv() !== null,
        mode: ticketWriteMode(),
        lastWebhook: webhook ? { at: webhook.at, entryId: webhook.entryId, outcome: webhook.outcome, ...(webhook.error ? { error: webhook.error } : {}) } : null,
        poll: poll ? {
          lastSuccessAt: poll.lastSuccessAt || null,
          lastRunAt: poll.lastRun?.at || null,
          lastRunErrors: poll.lastRun?.errors || [],
          seasonStartEntryId: poll.seasonStartEntryId,
        } : null,
        missed: Object.entries(poll?.missed || {}).map(([entryId, at]) => ({ entryId, at })).sort((a, b) => Number(a.entryId) - Number(b.entryId)),
        submittedAt: poll?.submittedAt || {},
        review,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tickets/fluent-forms/check-now", requirePermission("auction.stage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const run = await pollTicketPurchasesNow(`staff: ${req.user?.email || "unknown"}`);
      if (!run) return res.status(503).json({ error: "The Fluent Forms API isn't set up on the server (FLUENT_FORMS_SITE_URL, FLUENT_FORMS_API_USER, FLUENT_FORMS_API_PASSWORD)." });
      if (run.added.length > 0 || run.paymentsSet.length > 0) {
        await logAction(req, {
          area: "Tickets",
          action: "Check website ticket purchases",
          summary: `Checked the website's ticket purchases: added ${run.added.length} missed purchase(s), confirmed ${run.paymentsSet.length} payment(s)`,
          notUndoableReason: "each added row and payment is its own Action History row",
        });
      }
      res.json(run);
    } catch (error) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "The website ticket check is already running. Try again in a minute." });
      next(error);
    }
  });

  return router;
}
