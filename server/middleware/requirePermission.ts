import { Request, Response, NextFunction } from "express";
import { Capability, can } from "../utils/permissions";

const REFUSALS: Record<Capability, string> = {
  settings: "Only a Full Administrator can do this.",
  "users.manage": "Only a Full Administrator can manage users.",
  "auction.stage": "Only an Administrator can set up, start or close the auction.",
  "attendees.delete": "Only an Administrator can delete attendees.",
};

/**
 * Refuses (403) unless the signed-in person's role has `capability`
 * (server/utils/permissions.ts). Runs after requireAuth, which sets
 * req.user. Add it per route, not with router.use() on a router mounted
 * at a shared prefix such as "/api/auction" - router.use() middleware
 * runs for every request under that prefix, including other routers'
 * routes.
 */
export function requirePermission(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !can(req.user.role, capability)) {
      res.status(403).json({ error: REFUSALS[capability] });
      return;
    }
    next();
  };
}
