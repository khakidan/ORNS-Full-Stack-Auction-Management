import crypto from "crypto";

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
  const value = Buffer.from(JSON.stringify(session)).toString("base64");
  const sig = crypto
    .createHmac("sha1", process.env.SESSION_SECRET as string)
    .update(`orns_session=${value}`)
    .digest("base64")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=/g, "");
  return `orns_session=${value}; orns_session.sig=${sig}`;
}

/** `{ Cookie: ... }` for supertest's `.set()`, carrying the given OAuth tokens as a logged-in session. */
export function authCookieHeader(tokens: Record<string, unknown>): { Cookie: string } {
  return { Cookie: sessionCookie({ tokens }) };
}
