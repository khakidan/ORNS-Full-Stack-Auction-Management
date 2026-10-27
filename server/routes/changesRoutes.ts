import { Router, Request, Response } from 'express';
import { changesSince } from '../utils/changeFeed';

/**
 * GET /api/changes?since=N - what changed since the browser last looked
 * (changeFeed.ts). Answers from memory, no Google calls, so every open
 * browser can ask every few seconds.
 */
export default function createChangesRouter() {
  const router = Router();
  router.get("/changes", (req: Request, res: Response) => {
    const since = Number(req.query.since);
    res.json(changesSince(Number.isFinite(since) && since >= 0 ? since : 0));
  });
  return router;
}
