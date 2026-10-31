import { Request, Response, NextFunction } from "express";
import { Capability, can } from "../utils/permissions";

export const REFUSALS: Record<Capability, string> = {
  settings: "Only an Administrator can do this.",
  "settings.system": "Only a Full Administrator can do this.",
  "users.manage": "Only an Administrator can manage users.",
  "auction.stage": "Only an Administrator can set up, start or close the auction.",
  "tickets.edit": "The Auction Tickets page is view-only for your role - ask an Administrator.",
  "attendees.delete": "Only an Administrator can delete attendees.",
  "bidders.walkIn": "Volunteers can't register walk-ins - ask a staff member.",
  "items.standard": "Only an Administrator can change the standard items (Movie Night, raffle tickets, Open Appeal, Auction Tickets).",
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
