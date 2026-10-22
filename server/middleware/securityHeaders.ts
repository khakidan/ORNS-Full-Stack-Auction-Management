import { Request, Response, NextFunction } from "express";

/**
 * Browser security headers on every response - pages, assets, and API
 * (ROADMAP.md L9).
 *
 * - No site may put this app in a frame (`frame-ancestors 'none'`, plus
 *   the older X-Frame-Options for browsers that ignore CSP). Nothing frames
 *   it any more - AI Studio's iframe is gone - and a framed copy is how a
 *   clickjacking page would trick staff into clicking "Mark Paid".
 * - The CSP is otherwise limited to rules that can't break the app
 *   (`base-uri`, `object-src`); it doesn't restrict scripts, styles, or
 *   connections, since the app loads Google Fonts, Firebase, and Vite's
 *   dev client, and a wrong allow-list would break pages silently.
 * - HSTS only when cookies are secure (the deployed HTTPS build), so a
 *   local http://localhost is never told to insist on HTTPS.
 */
export function createSecurityHeaders(opts: { hsts: boolean }) {
  return function securityHeaders(req: Request, res: Response, next: NextFunction): void {
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (opts.hsts) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  };
}
