import { Request, Response, NextFunction } from "express";

/**
 * Global middleware to prevent caching (required for Firebase Hosting to preserve Set-Cookie)
 */
export function cacheControl(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  }
  next();
}
