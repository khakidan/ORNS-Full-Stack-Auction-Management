import { Router, Request, Response } from 'express';
import { changesSince } from '../utils/changeFeed';
import { syncBiddersFromTickets } from '../services/bidderTicketSync';

/**
 * GET /api/changes?since=N - what changed since the browser last looked
 * (changeFeed.ts). Answers from memory, so every open browser can ask
 * every few seconds - except about once a minute, when it first checks
 * bidders against the tickets (bidderTicketSync.ts).
 */
export default function createChangesRouter() {
  const router = Router();
  router.get("/changes", async (req: Request, res: Response) => {
    // About once a minute, while anyone on staff has the app open, bring
    // bidders in line with the tickets - this is what catches a name or
    // email changed directly in the Auction Tickets spreadsheet. A change
    // it makes shows up in this same answer, so screens reload it at once.
    if (req.user?.role !== "volunteer") await syncBiddersFromTickets(req, { background: true });
    const since = Number(req.query.since);
    const changes = changesSince(Number.isFinite(since) && since >= 0 ? since : 0);
    // Volunteers only work in Bid Management; other undo notices name staff
    // and attendees they have no business seeing (ROADMAP A9).
    if (req.user?.role === "volunteer") changes.notices = changes.notices.filter((n) => n.area === "Bid Management");
    res.json(changes);
  });
  return router;
}
