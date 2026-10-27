import { Router, Request, Response, NextFunction } from 'express';
import { logAction } from '../services/actionLog';
import { requirePermission } from '../middleware/requirePermission';
import { getRole, isBootstrapAdmin, listUsers, normalizeEmail, setRole } from '../services/userService';
import { isRole, ROLE_LABELS } from '../utils/permissions';

const ORNS_EMAIL = /^[^\s@]+@orns\.org$/i;

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

  /**
   * Sets a role. "user" removes an admin role. Only @orns.org addresses;
   * a FULL_ADMIN_EMAILS address and your own role can't be changed here,
   * so nobody can lock every Full Administrator out by accident.
   */
  router.put("/users/:email/role", requirePermission("users.manage"), async (req: Request, res: Response, next: NextFunction) => {
    const email = normalizeEmail(decodeURIComponent(req.params.email));
    const { role } = req.body || {};
    if (!ORNS_EMAIL.test(email)) {
      return res.status(400).json({ error: "Roles can only be given to @orns.org addresses." });
    }
    if (!isRole(role)) {
      return res.status(400).json({ error: "Role must be full_admin, admin or user." });
    }
    if (isBootstrapAdmin(email)) {
      return res.status(400).json({ error: `${email} is a Full Administrator set on the server (FULL_ADMIN_EMAILS) and can't be changed here.` });
    }
    if (email === normalizeEmail(req.user!.email)) {
      return res.status(400).json({ error: "You can't change your own role." });
    }
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
