import { Router } from "express";
import crypto from "crypto";
import { runPaypalSweep } from "../services/paypalSweeperJob";

/**
 * Endpoints called by Google Cloud Scheduler, not by people - so no
 * session. Each request must carry the shared secret from the
 * SWEEPER_TRIGGER_SECRET env var in an `X-Sweeper-Secret` header (set on
 * the Cloud Scheduler job; see README.md "Deployment"). With the env var
 * unset (local development) the endpoint doesn't exist.
 *
 * The worst a leaked secret allows is running a sweep early - the same
 * thing the in-app "Run Sweep Now" button does.
 */
function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export default function createSchedulerRouter() {
  const router = Router();

  router.post("/paypal-sweep", async (req, res, next) => {
    const expected = process.env.SWEEPER_TRIGGER_SECRET?.trim();
    if (!expected) return res.status(404).end();
    if (!secretMatches(req.get("X-Sweeper-Secret"), expected)) {
      return res.status(401).json({ error: "Invalid scheduler secret" });
    }

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

  return router;
}
