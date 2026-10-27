import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission';
import { getSharedConfig, saveSharedConfig, validateConfig, InvalidConfigError } from '../services/configService';
import { getRuntimeConfig } from '../services/volunteerService';
import { logAction } from '../services/actionLog';
import { CONFIG_KEY, noteChange } from '../utils/changeFeed';

/**
 * The auction's shared Config (configService.ts). Every signed-in person
 * reads it from here - staff get all of it, a volunteer only the Bid
 * Management fields - and only Full Administrators save it.
 */
export default function createConfigRouter() {
  const router = Router();

  router.get("/config", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(req.user?.role === "volunteer" ? await getRuntimeConfig() : await getSharedConfig());
    } catch (error) {
      next(error);
    }
  });

  router.post("/config", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    let config;
    try {
      config = validateConfig(req.body);
    } catch (error) {
      if (error instanceof InvalidConfigError) return res.status(400).json({ error: error.message });
      return next(error);
    }
    try {
      const before = await saveSharedConfig(config, req.user!.email);
      const changed = (Object.keys(config) as (keyof typeof config)[]).filter((k) => before[k] !== config[k]);
      noteChange(CONFIG_KEY);
      await logAction(req, {
        area: "Settings",
        action: "Save configuration",
        summary: changed.length ? `Changed ${changed.join(", ")}` : "Saved the configuration (nothing changed)",
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, config[k]])),
        notUndoableReason: "save the configuration again to change it",
      });
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
