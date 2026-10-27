import { Router, Request, Response, NextFunction, urlencoded } from 'express';
import crypto from 'crypto';
import { getOAuthClient, SCOPES } from '../services/oauth';
import { getRole } from '../services/userService';
import {
  findVolunteerByToken,
  getAuctionStateForVolunteers,
  getVolunteerAuthClient,
  redeemVolunteer,
  volunteerAccountEmail,
} from '../services/volunteerService';

/**
 * Volunteer sign-in, outside /api (no session yet), plus the Full
 * Administrator's "Connect" step for the shared volunteer Google account.
 *
 * The one-time link is two steps on purpose: GET only shows a "Sign in"
 * button, POST uses the link up. Email security scanners (Outlook Safe
 * Links, Gmail) open links automatically - a GET that redeemed the token
 * would burn it before the volunteer ever clicked.
 */

// Link attempts per IP, in-process like the bug-report limiter.
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, number[]>();

function allowAttempt(ip: string, now = Date.now()): boolean {
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    attempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 10_000) attempts.clear();
  return true;
}

/** Test-only. */
export function _resetVolunteerLinkRateLimitForTesting(): void {
  attempts.clear();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 15vh auto; padding: 0 1rem; text-align: center; color: #1e293b;">
    <h1 style="font-size: 1.4rem;">${escapeHtml(title)}</h1>
    ${body}
  </body>
</html>`;
}

const LINK_INVALID = page("This link can't be used", "<p>This link has already been used or is no longer valid. Ask an auction organizer to send you a new one.</p>");
const NOT_LIVE = page("The auction isn't live yet", "<p>Your link will work once the auction starts. Open it again then - it hasn't been used up.</p>");
const NOT_SET_UP = page("Volunteer access isn't ready", "<p>Volunteer access hasn't been set up yet. Let an auction organizer know, and try the link again later - it hasn't been used up.</p>");
const TOO_MANY = page("Too many tries", "<p>Please wait a few minutes and try again.</p>");

/** Whether volunteers can sign in right now; returns an error page if not. */
async function blockedPage(): Promise<string | null> {
  if (!(await getVolunteerAuthClient())) return NOT_SET_UP;
  try {
    if ((await getAuctionStateForVolunteers()) !== "live") return NOT_LIVE;
  } catch {
    return NOT_SET_UP;
  }
  return null;
}

export default function createVolunteerAuthRouter() {
  const router = Router();

  router.get("/auth/volunteer", async (req: Request, res: Response, next: NextFunction) => {
    if (!allowAttempt(req.ip || "")) return res.status(429).send(TOO_MANY);
    const token = String(req.query.token || "");
    try {
      const volunteer = await findVolunteerByToken(token);
      if (!volunteer || volunteer.status !== "invited") return res.status(410).send(LINK_INVALID);
      const blocked = await blockedPage();
      if (blocked) return res.send(blocked);
      res.send(page(`Welcome, ${volunteer.name || volunteer.email}`, `
        <p>You've been invited to help with the ORNS auction. This link works once, on this device.</p>
        <form method="POST" action="/auth/volunteer">
          <input type="hidden" name="token" value="${escapeHtml(token)}">
          <button type="submit" style="font-size: 1rem; padding: 0.7rem 1.4rem; border-radius: 0.5rem; border: 0; background: #b91c1c; color: white; cursor: pointer;">
            Sign in as ${escapeHtml(volunteer.name || volunteer.email)}
          </button>
        </form>`));
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/volunteer", urlencoded({ extended: false, limit: "4kb" }), async (req: Request, res: Response, next: NextFunction) => {
    if (!allowAttempt(req.ip || "")) return res.status(429).send(TOO_MANY);
    const token = String(req.body?.token || "");
    try {
      const volunteer = await findVolunteerByToken(token);
      if (!volunteer || volunteer.status !== "invited") return res.status(410).send(LINK_INVALID);
      const blocked = await blockedPage();
      if (blocked) return res.send(blocked);

      await redeemVolunteer(volunteer.id);
      // A fresh session: a volunteer, with no staff sign-in mixed in.
      req.session = { volunteer: { id: volunteer.id, email: volunteer.email } };
      res.redirect(303, "/BidManagement");
    } catch (error) {
      next(error);
    }
  });

  /**
   * Full Administrator: starts Google sign-in as the shared volunteer
   * account. The callback (authRoutes.ts) sees `oauthPurpose`, stores that
   * account's sign-in for volunteers, and leaves the admin's own session
   * as it was.
   */
  router.get("/auth/volunteer-account/connect", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.session?.email;
      if (!req.session?.tokens || !email || (await getRole(email)) !== "full_admin") {
        return res.status(403).send(page("Not allowed", "<p>Only a Full Administrator can connect the volunteer account.</p>"));
      }
      const account = volunteerAccountEmail();
      if (!account) {
        return res.status(500).send(page("Not configured", "<p>VOLUNTEER_GOOGLE_ACCOUNT isn't set on the server.</p>"));
      }
      const state = crypto.randomBytes(24).toString("base64url");
      req.session.oauthState = state;
      req.session.oauthPurpose = "volunteer-account";
      const url = getOAuthClient(req).generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "select_account consent",
        hd: "orns.org",
        login_hint: account,
        state,
      });
      res.redirect(url);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
