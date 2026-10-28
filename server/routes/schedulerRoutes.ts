import { Router, Request, Response, NextFunction } from "express";
import { runPaypalSweep } from "../services/paypalSweeperJob";
import { pollTicketPurchasesNow } from "../services/ticketPoll";
import { AlreadyRunningError } from "../utils/asyncLock";
import { secretMatches } from "../utils/sharedSecret";

/**
 * Endpoints called by Google Cloud Scheduler, not by people - so no
 * session. Each request must carry the shared secret from the
 * SWEEPER_TRIGGER_SECRET env var in an `X-Sweeper-Secret` header (set on
 * the Cloud Scheduler job; see README.md "Deployment"). With the env var
 * unset (local development) the endpoint doesn't exist.
 *
 * The worst a leaked secret allows is running a sweep or the ticket poll
 * early - the same things the in-app "Run Sweep Now" and "Check now"
 * buttons do.
 */
export default function createSchedulerRouter() {
  const router = Router();

  const requireSchedulerSecret = (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env.SWEEPER_TRIGGER_SECRET?.trim();
    if (!expected) return res.status(404).end();
    if (!secretMatches(req.get("X-Sweeper-Secret"), expected)) {
      return res.status(401).json({ error: "Invalid scheduler secret" });
    }
    next();
  };

  router.post("/paypal-sweep", requireSchedulerSecret, async (req, res, next) => {

    try {
      const outcome = await runPaypalSweep("scheduler");
      if ("skipped" in outcome) {
        console.log(`[PayPalSweeper] Scheduled run skipped: ${outcome.skipped}`);
      } else if (outcome.pending > 0) {
        console.log(`[PayPalSweeper] Scheduled run swept ${outcome.pending} pending row(s): ${outcome.resolved} resolved, ${outcome.escalated} escalated.`);
      }
      res.json(outcome);
    } catch (error) {
      next(error);
    }
  });

  /**
   * The website ticket poll (ROADMAP W5), a few times a day (Cloud
   * Scheduler job `fluent-forms-poll`). 503 until the Fluent Forms API is
   * set up; a run with errors answers 500, so the job's log shows it.
   */
  router.post("/fluent-forms-poll", requireSchedulerSecret, async (_req, res, next) => {
    try {
      const run = await pollTicketPurchasesNow("scheduler");
      if (!run) return res.status(503).json({ error: "The Fluent Forms API isn't set up on the server." });
      res.status(run.errors.length > 0 ? 500 : 200).json(run);
    } catch (error) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "Already running." });
      next(error);
    }
  });

  return router;
}
