import { Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { getOAuthClient } from "../services/oauth";

const ALLOWED_DOMAIN = "orns.org";
const VALIDATION_TTL_MS = 5 * 60 * 1000;

// access_token -> epoch ms until which it's considered already-validated.
const validatedTokens = new Map<string, number>();

/**
 * Confirms a token blob handed to us via the x-google-tokens header
 * actually belongs to a currently-valid @orns.org Google account, the
 * same domain gate authRoutes.ts applies at OAuth callback time. Without
 * this, any client could hand this header an arbitrary token it holds
 * (its own personal Google account, a leaked/phished token) and inherit a
 * full authenticated session, since requireAuth only checks that
 * req.session.tokens is truthy. Successful checks are cached briefly per
 * access_token to avoid a Google round trip on every request.
 */
async function isAuthorizedOrnsAccount(tokens: unknown): Promise<boolean> {
  const accessToken = (tokens as { access_token?: unknown } | null)?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return false;

  const validUntil = validatedTokens.get(accessToken);
  if (validUntil && validUntil > Date.now()) return true;

  try {
    const client = getOAuthClient();
    // Only the access_token is needed to resolve the account; passing the
    // whole blob risks google-auth-library seeing a stale/absent
    // expiry_date and attempting a refresh (which fails without a
    // refresh_token), and setCredentials(tokens) would otherwise mutate
    // the caller's object in place via shared reference.
    client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email || "";
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return false;
    validatedTokens.set(accessToken, Date.now() + VALIDATION_TTL_MS);
    return true;
  } catch (e) {
    console.error("[Token Restorer] Token validation failed:", e);
    return false;
  }
}

/**
 * Restore session tokens if present in client headers, bypassing cookie block restrictions
 */
export async function tokenRestorer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tokenHeader = req.headers["x-google-tokens"];
  if (tokenHeader && typeof tokenHeader === "string") {
    try {
      const parsed = JSON.parse(tokenHeader);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (await isAuthorizedOrnsAccount(parsed)) {
          if (!req.session) {
            req.session = {} as any;
          }
          req.session!.tokens = parsed;
          console.log(`[Token Restorer] Successfully restored tokens for ${req.path}`);
        } else {
          console.warn(`[Token Restorer] Rejected unauthorized or invalid token for ${req.path}`);
        }
      }
    } catch (e) {
      console.error("[Token Restorer] Failed to parse custom token header:", e);
    }
  }
  next();
}
