import { Request, Response, NextFunction } from "express";

/**
 * Guards every route on a router behind an active session. Replaces the
 * identical `if (!req.session?.tokens) return res.status(401).json({
 * error: "Unauthorized" });` line that used to be hand-copied at the top
 * of 27 individual route handlers across setupRoutes.ts, bundleRoutes.ts,
 * dataRoutes.ts, receiptRoutes.ts, bidRoutes.ts, and productionRoutes.ts -
 * apply via `router.use(requireAuth)` on any router where every route
 * requires auth (all six of those do; authRoutes.ts's pre-auth routes
 * must NOT use this).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.tokens) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
