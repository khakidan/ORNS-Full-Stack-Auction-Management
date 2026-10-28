import { Router, Request, Response, NextFunction } from "express";
import { requirePermission } from "../middleware/requirePermission";
import { logAction } from "../services/actionLog";
import { pollTicketPurchasesNow } from "../services/ticketPoll";
import { AlreadyRunningError } from "../utils/asyncLock";

/**
 * "Check now" for the website ticket poll (ROADMAP W5): the same run Cloud
 * Scheduler makes a few times a day, on demand. Each row it adds or
 * payment it confirms is in Action History as "Fluent Forms (website)";
 * this records who asked for the run.
 */
export default function createTicketPollRouter() {
  const router = Router();

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
