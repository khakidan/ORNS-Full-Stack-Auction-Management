import { Request, Response, NextFunction } from "express";
import { getRole } from "../services/userService";
import { capabilitiesFor } from "../utils/permissions";
import {
  getAuctionStateForVolunteers,
  getRuntimeConfig,
  getVolunteerAuthClient,
  getVolunteerStatus,
  touchVolunteer,
} from "../services/volunteerService";
import { volunteerRefusal } from "./volunteerAccess";

/** What a volunteer whose access has ended gets, so the app can say so. */
export const VOLUNTEER_ACCESS_ENDED = "volunteer_access_ended";

/**
 * Guards every route on a router behind an active session, and works out
 * who is asking: `req.user` = { email, role, capabilities }. Apply via
 * `router.use(requireAuth)` on any router where every route requires auth
 * (authRoutes.ts's pre-auth routes must NOT use this).
 *
 * Staff: a session without an email is one from before roles existed - it
 * gets 401 like no session at all, so that person signs in once more.
 *
 * Volunteers (session.volunteer): allowed only while their record is
 * active and the auction is Live - otherwise the session is ended and the
 * answer is 401 with reason "volunteer_access_ended" - and only for the
 * routes in volunteerAccess.ts. Their requests use the shared volunteer
 * account's Google access (req.googleAuth).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const volunteer = req.session?.volunteer;
    if (volunteer) {
      const ended = await volunteerAccessEnded(volunteer.id);
      if (ended) {
        req.session = null;
        res.status(401).json({ error: "Volunteer access has ended.", reason: VOLUNTEER_ACCESS_ENDED, detail: ended });
        return;
      }
      const refusal = volunteerRefusal(req, await getRuntimeConfig());
      if (refusal) {
        res.status(403).json({ error: refusal });
        return;
      }
      const client = await getVolunteerAuthClient();
      if (!client) {
        res.status(503).json({ error: "Volunteer access isn't set up - ask an organizer to connect the volunteer account." });
        return;
      }
      req.user = { email: volunteer.email, role: "volunteer", capabilities: capabilitiesFor("volunteer"), volunteerId: volunteer.id };
      req.googleAuth = client;
      touchVolunteer(volunteer.id);
      next();
      return;
    }

    const email = req.session?.email;
    if (!req.session?.tokens || !email) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const role = await getRole(email);
    req.user = { email, role, capabilities: capabilitiesFor(role) };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Why a volunteer's access is over ("revoked", "auction_not_live"...), or
 * null if it's fine. A failed check (Google or Firestore unreachable)
 * throws instead - that must not sign someone out mid-auction.
 */
export async function volunteerAccessEnded(volunteerId: string): Promise<string | null> {
  const status = await getVolunteerStatus(volunteerId);
  if (status !== "active") return status === null ? "unknown" : status;
  const state = await getAuctionStateForVolunteers();
  return state === "live" ? null : "auction_not_live";
}
