import { Request, Response, NextFunction } from "express";

/**
 * Dynamic cookie settings middleware for proper iframe (AI Studio build site) and top-level tab sameSite settings
 */
export function cookiePolicy(req: Request, res: Response, next: NextFunction): void {
  // Access sessionOptions if present (from cookie-session)
  const anyReq = req as any;
  if (anyReq.sessionOptions) {
    const host = req.get("host") || "";
    const isIframe = req.get("sec-fetch-dest") === "iframe" || host.includes("ais-dev-") || host.includes("ais-pre-");
    
    if (process.env.NODE_ENV === "production" && !host.includes("localhost")) {
      anyReq.sessionOptions.secure = true;
      anyReq.sessionOptions.sameSite = isIframe ? "none" : "lax";
    } else {
      anyReq.sessionOptions.secure = false;
      anyReq.sessionOptions.sameSite = "lax";
    }
  }
  next();
}
