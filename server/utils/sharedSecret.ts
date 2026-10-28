import crypto from "crypto";

/**
 * Whether a header's value is the expected shared secret, compared in
 * constant time (hashing first makes the lengths equal), for endpoints
 * called by other services rather than people: Cloud Scheduler and the
 * Fluent Forms webhook.
 */
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
