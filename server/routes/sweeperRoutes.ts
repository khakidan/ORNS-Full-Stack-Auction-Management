import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission';
import { getSweeperStatus, runPaypalSweep } from '../services/paypalSweeperJob';

/**
 * The Settings page's PayPal sweeper card: its status (stored
 * background credential, last runs) and a Run Now button, so the sweeper
 * can be checked from the app instead of only from server logs.
 */
export default function createSweeperRouter() {
  const router = Router();

  router.get("/paypal-sweeper/status", requirePermission("settings.system"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getSweeperStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post("/paypal-sweeper/run-now", requirePermission("settings.system"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await runPaypalSweep());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
