import { fetchWithRetry, getBaseUrl, postOnce } from "@/services/google-api";

/** A request the server answered with an error (4xx/5xx, or an `error` in the body). */
export class HttpError extends Error {
  readonly status: number;
  readonly body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * POSTs `body` as JSON to one of the app's own routes, with
 * fetchWithRetry's retries, and returns the parsed reply.
 *
 * Throws HttpError when the server refuses (non-2xx, or an `error` field
 * in the reply), carrying the server's own reason - its error handler puts
 * that in `message`, other routes in `error` - or `fallbackError` plus
 * the HTTP status.
 * ServerUnreachableError (no answer at all) passes through unchanged.
 *
 * Not for requests that mustn't be repeated (use postOnce) or that need
 * the raw Response (the winning-bid outbox, checkout).
 */
export async function postJson<T = any>(path: string, body: unknown, fallbackError: string): Promise<T> {
  const res = await fetchWithRetry(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  return readReply<T>(res, fallbackError);
}

/**
 * postJson without the retries, for a request that mustn't run twice: a
 * resent invite emails a second link (and the first stops working), a
 * resent Undo reports "already undone" though it worked (ROADMAP A7).
 */
export async function postJsonOnce<T = any>(path: string, body: unknown, fallbackError: string): Promise<T> {
  return readReply<T>(await postOnce(`${getBaseUrl()}${path}`, body), fallbackError);
}

async function readReply<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const reason = (!res.ok && data?.message) || data?.error || (res.ok ? fallbackError : `${fallbackError} (status ${res.status})`);
    throw new HttpError(reason, res.status, data);
  }
  return data;
}
