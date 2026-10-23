import { Router, Request, Response, NextFunction } from 'express';
import { getSweeperStatus, runPaypalSweep } from '../services/paypalSweeperJob';

/**
 * The Configuration page's PayPal sweeper card: its status (stored
 * background credential, last runs) and a Run Now button, so the sweeper
 * can be checked from the app instead of only from server logs.
 */
export default function createSweeperRouter() {
  const router = Router();

  router.get("/paypal-sweeper/status", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getSweeperStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post("/paypal-sweeper/run-now", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await runPaypalSweep());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
