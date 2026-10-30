import { Router, Request, Response, NextFunction } from "express";
import { requirePermission } from "../middleware/requirePermission";
import { logAction } from "../services/actionLog";
import { fluentFormsApiFromEnv } from "../services/fluentFormsApi";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { pollTicketPurchasesNow, readTicketPollStatus } from "../services/ticketPoll";
import { dismissReview, listReview, ticketWriteMode } from "../services/ticketPurchaseService";
import { listAfterGoLive, markAfterGoLiveHandled } from "../services/ticketsAfterGoLive";
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
   * poll's last runs, the entries the poll had to add, the review list,
   * and purchases that arrived after Go Live (W7) - so a failure shows up
   * days before the auction, not at check-in.
   */
  router.get("/tickets/fluent-forms/status", requirePermission("auction.stage"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [webhookDoc, poll, review, afterGoLive] = await Promise.all([
        getAdminFirestore().collection("system").doc("fluentFormsTickets").get(),
        readTicketPollStatus(),
        listReview(),
        listAfterGoLive(),
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
        afterGoLive,
      });
    } catch (error) {
      next(error);
    }
  });

  /** W7: staff registered a purchase that arrived after Go Live as a walk-in - it leaves the card. */
  router.post("/tickets/fluent-forms/after-go-live/:entryId/handled", requirePermission("auction.stage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const handled = await markAfterGoLiveHandled(String(req.params.entryId), req.user!.email);
      if (!handled) return res.status(404).json({ error: "That purchase isn't waiting to be registered." });
      await logAction(req, {
        area: "Tickets",
        action: "Register late website purchase",
        target: handled.name,
        summary: `Marked ${handled.name}'s website purchase (entry ${handled.entryId}, bought after Go Live) as registered as a walk-in`,
        notUndoableReason: "it only takes the purchase off the Website Ticket Check list",
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  /** Staff sorted out an entry on the review list themselves - it leaves the card (back if the next check finds the same problem). */
  router.post("/tickets/fluent-forms/review/:entryId/clear", requirePermission("auction.stage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cleared = await dismissReview(String(req.params.entryId));
      if (!cleared) return res.status(404).json({ error: "That purchase isn't on the review list." });
      await logAction(req, {
        area: "Tickets",
        action: "Clear website purchase review",
        target: cleared.name,
        summary: `Took ${cleared.name || "a website purchase"}'s entry ${cleared.entryId} off the Website Ticket Check review list (${cleared.problems.join("; ").slice(0, 300)})`,
        notUndoableReason: "it only takes the purchase off the Website Ticket Check list; the next check puts it back if the problem is still there",
      });
      res.json({ success: true });
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
