import { Router, Request, Response, NextFunction } from 'express';
import { logAction } from '../services/actionLog';
import { requirePermission } from '../middleware/requirePermission';
import { getRole, listUsers, normalizeEmail, roleChangeRefusal, setRole } from '../services/userService';
import { isRole, ROLE_LABELS } from '../utils/permissions';

/** The Settings page's Users tab: staff roles (Full Administrator only). */
export default function createUserRouter() {
  const router = Router();

  router.get("/users", requirePermission("users.manage"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ users: await listUsers() });
    } catch (error) {
      next(error);
    }
  });

  /** Sets a role. "user" removes an admin role. `roleChangeRefusal` says who can't be changed. */
  router.put("/users/:email/role", requirePermission("users.manage"), async (req: Request, res: Response, next: NextFunction) => {
    const email = normalizeEmail(decodeURIComponent(req.params.email));
    const { role } = req.body || {};
    const refusal = roleChangeRefusal(email, role, req.user!.email);
    if (refusal || !isRole(role)) return res.status(400).json({ error: refusal });
    try {
      const before = await getRole(email);
      await setRole(email, role, req.user!.email);
      await logAction(req, {
        area: "Users",
        action: "Change role",
        target: email,
        summary: `${email}: ${ROLE_LABELS[before]} -> ${ROLE_LABELS[role]}`,
        before: before,
        after: role,
        undo: { kind: "role", email, before, after: role },
      });
      res.json({ success: true, email, role });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
