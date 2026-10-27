import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { requirePermission } from '../middleware/requirePermission';
import { googleAuthFor } from '../utils/googleClients';
import { createRawEmail, getSenderEmail, isValidEmailAddress } from '../services/emailService';
import { logAction } from '../services/actionLog';
import {
  clearEndedVolunteers,
  getVolunteerAccountStatus,
  inviteVolunteer,
  listVolunteers,
  resendVolunteerLink,
  revokeVolunteer,
  Volunteer,
} from '../services/volunteerService';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function linkFor(token: string): string {
  const base = (process.env.APP_URL || "").replace(/\/+$/, "");
  return `${base}/auth/volunteer?token=${encodeURIComponent(token)}`;
}

/** Sends the one-time link from the inviting admin's own Gmail. */
async function emailLink(req: Request, volunteer: Volunteer, token: string): Promise<void> {
  const client = googleAuthFor(req);
  const link = linkFor(token);
  const html = `
    <p>Hi ${escapeHtml(volunteer.name || "there")},</p>
    <p>Thank you for volunteering at the ORNS auction! Use the link below to sign in to the auction app on the night.</p>
    <p><a href="${escapeHtml(link)}">Sign in to the ORNS Auction app</a></p>
    <ul>
      <li>It works once the auction is live, and only once - open it on the phone or computer you'll use.</li>
      <li>Your access ends automatically when the auction closes.</li>
      <li>If it doesn't work, ask an organizer to send you a new link.</li>
    </ul>`;
  const raw = createRawEmail(volunteer.email, "Your ORNS Auction volunteer sign-in link", html, "ORNS Auction", await getSenderEmail(client));
  await google.gmail({ version: "v1", auth: client }).users.messages.send({ userId: "me", requestBody: { raw } });
}

/** Settings > Users: volunteers (Full Administrator only). */
export default function createVolunteerRouter() {
  const router = Router();

  router.get("/volunteers", requirePermission("users.manage"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [volunteers, account] = await Promise.all([listVolunteers(), getVolunteerAccountStatus()]);
      res.json({ volunteers, account });
    } catch (error) {
      next(error);
    }
  });

  router.post("/volunteers", requirePermission("users.manage"), async (req: Request, res: Response, next: NextFunction) => {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!name || !isValidEmailAddress(email)) {
      return res.status(400).json({ error: "A name and a valid email address are required." });
    }
    if (email.endsWith("@orns.org")) {
      return res.status(400).json({ error: "@orns.org staff sign in with their own account - give them a role instead." });
    }
    try {
      const { volunteer, token } = await inviteVolunteer(email, name, req.user!.email);
      await emailLink(req, volunteer, token);
      await logAction(req, { area: "Users", action: "Invite volunteer", target: email, summary: `Invited ${name} (${email}) as a volunteer`, notUndoableReason: "revoke the volunteer instead" });
      res.json({ volunteer });
    } catch (error) {
      next(error);
    }
  });

  router.post("/volunteers/:id/resend", requirePermission("users.manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await resendVolunteerLink(req.params.id, req.user!.email);
      if (!result) return res.status(404).json({ error: "That volunteer isn't in the list." });
      await emailLink(req, result.volunteer, result.token);
      await logAction(req, { area: "Users", action: "Resend volunteer link", target: result.volunteer.email, summary: `Sent ${result.volunteer.email} a new sign-in link (the old one no longer works)`, notUndoableReason: "revoke the volunteer instead" });
      res.json({ volunteer: result.volunteer });
    } catch (error) {
      next(error);
    }
  });

  router.post("/volunteers/:id/revoke", requirePermission("users.manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await revokeVolunteer(req.params.id))) return res.status(404).json({ error: "That volunteer isn't in the list." });
      await logAction(req, { area: "Users", action: "Revoke volunteer", target: req.params.id, summary: "Ended a volunteer's access", notUndoableReason: "send them a new link to give access back" });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/volunteers/clear-ended", requirePermission("users.manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await clearEndedVolunteers();
      await logAction(req, { area: "Users", action: "Clear ended volunteers", summary: `Removed ${removed} revoked or deactivated volunteer(s) from the list`, notUndoableReason: "the records are deleted" });
      res.json({ removed });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
