import crypto from "crypto";
import { sealTokens } from "../../utils/sealedSessionTokens";

/**
 * Builds the Cookie header a real login leaves in the browser: an
 * `orns_session` cookie-session payload plus its `orns_session.sig`
 * signature, signed with the test SESSION_SECRET (vitest.config.ts).
 * Lets route tests authenticate the same way production requests do,
 * through the session cookie, instead of a test-only side channel.
 *
 * Mirrors cookie-session's encoding (base64 JSON) and keygrip's default
 * signature (HMAC-SHA1 over "name=value", base64url without padding).
 */
export function sessionCookie(session: Record<string, unknown>): string {
  // The app keeps the Google tokens encrypted in `sealedTokens` (sealedSessionTokens.ts).
  const { tokens, ...rest } = session;
  const stored = tokens === undefined ? rest : { ...rest, sealedTokens: sealTokens(tokens) };
  const value = Buffer.from(JSON.stringify(stored)).toString("base64");
  const sig = crypto
    .createHmac("sha1", process.env.SESSION_SECRET as string)
    .update(`orns_session=${value}`)
    .digest("base64")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=/g, "");
  return `orns_session=${value}; orns_session.sig=${sig}`;
}

/**
 * The address every test session signs in as unless one is given. It is
 * listed in FULL_ADMIN_EMAILS (vitest.config.ts), so it is a Full
 * Administrator without any Firestore read - existing route tests keep
 * full access; permission tests pass their own address.
 */
export const TEST_ADMIN_EMAIL = "test-admin@orns.org";

/** `{ Cookie: ... }` for supertest's `.set()`, carrying the given OAuth tokens as a logged-in session for `email`. */
export function authCookieHeader(tokens: Record<string, unknown>, email: string = TEST_ADMIN_EMAIL): { Cookie: string } {
  return { Cookie: sessionCookie({ tokens, email }) };
}
