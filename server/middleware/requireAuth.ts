import { Request, Response, NextFunction } from "express";
import { getRole } from "../services/userService";
import { capabilitiesFor } from "../utils/permissions";

/**
 * Guards every route on a router behind an active session, and works out
 * who is asking: `req.user` = { email, role, capabilities }. Apply via
 * `router.use(requireAuth)` on any router where every route requires auth
 * (authRoutes.ts's pre-auth routes must NOT use this).
 *
 * A session without an email is one from before roles existed: it gets
 * 401 like no session at all, so that person signs in once more.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const email = req.session?.email;
  if (!req.session?.tokens || !email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const role = await getRole(email);
    req.user = { email, role, capabilities: capabilitiesFor(role) };
    next();
  } catch (err) {
    next(err);
  }
}
