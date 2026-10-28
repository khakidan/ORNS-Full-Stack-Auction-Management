import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * The orns_session cookie is signed, not encrypted: its value is base64
 * JSON anyone holding a copy can read. The Google tokens in it (the
 * refresh token works on Google directly, outside this app) are kept
 * encrypted instead - AES-256-GCM with a key derived from SESSION_SECRET,
 * in the session field `sealedTokens` (ROADMAP B6).
 *
 * Code keeps reading and writing `req.session.tokens`: `sealSessionTokens`
 * gives cookie-session's Session objects a `tokens` accessor that decrypts
 * and encrypts `sealedTokens`. It's on the prototype, not the object, so it
 * is never written to the cookie. (cookie-session copies a cookie's fields
 * onto a new Session only when the prototype has no property of that name,
 * so a cookie from before this change - plaintext `tokens` - is dropped
 * and that person signs in once more.)
 */
const KEY_LABEL = "orns-session-tokens-v1";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to seal session tokens.");
  return crypto.createHmac("sha256", secret).update(KEY_LABEL).digest();
}

/** `iv.tag.ciphertext`, each base64url. */
export function sealTokens(tokens: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

/** The tokens, or undefined if `sealed` is missing or doesn't decrypt (another key, tampered). */
export function unsealTokens(sealed: unknown): any {
  if (typeof sealed !== "string") return undefined;
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p || "", "base64url"));
  if (!iv?.length || !tag?.length || !data) return undefined;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
  } catch {
    return undefined;
  }
}

const patched = new WeakSet<object>();

/** Middleware, right after cookieSession: installs the `tokens` accessor on the Session prototype (once). */
export function sealSessionTokens(req: Request, _res: Response, next: NextFunction): void {
  const session = req.session;
  const proto = session && Object.getPrototypeOf(session);
  if (proto && proto !== Object.prototype && !patched.has(proto)) {
    Object.defineProperty(proto, "tokens", {
      configurable: true,
      enumerable: false,
      get(this: { sealedTokens?: string }) {
        return unsealTokens(this.sealedTokens);
      },
      set(this: { sealedTokens?: string }, value: unknown) {
        if (value == null) delete this.sealedTokens;
        else this.sealedTokens = sealTokens(value);
      },
    });
    patched.add(proto);
  }
  // The first request after start-up read its cookie before the accessor
  // existed, so an old plaintext `tokens` field is an own property there -
  // drop it like any other pre-sealing cookie.
  if (session && Object.prototype.hasOwnProperty.call(session, "tokens")) delete (session as any).tokens;
  next();
}
