import { Request, Response, NextFunction } from "express";

/**
 * Restore session tokens if present in client headers, bypassing cookie block restrictions
 */
export function tokenRestorer(req: Request, res: Response, next: NextFunction): void {
  const tokenHeader = req.headers["x-google-tokens"];
  if (tokenHeader && typeof tokenHeader === "string") {
    try {
      const parsed = JSON.parse(tokenHeader);
      if (parsed) {
        if (!req.session) {
          req.session = {} as any;
        }
        req.session!.tokens = parsed;
        console.log(`[Token Restorer] Successfully restored tokens for ${req.path}`);
      }
    } catch (e) {
      console.error("[Token Restorer] Failed to parse custom token header:", e);
    }
  }
  next();
}
