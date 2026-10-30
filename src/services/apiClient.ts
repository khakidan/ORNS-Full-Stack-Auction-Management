import { fetchWithRetry, getBaseUrl, postOnce } from "@/services/google-api";
import type { ApiRequestBody } from "../../shared/apiTypes";

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
 *
 * `body` must match the path's type in shared/apiTypes.ts, so a field
 * renamed on either side fails the type check. The reply isn't checked:
 * annotate the variable it's assigned to.
 */
export async function postJson<P extends string>(path: P, body: ApiRequestBody<P>, fallbackError: string): Promise<any> {
  const res = await fetchWithRetry(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  return readReply(res, fallbackError);
}

/**
 * postJson without the retries, for a request that mustn't run twice: a
 * resent invite emails a second link (and the first stops working), a
 * resent Undo reports "already undone" though it worked (ROADMAP A7).
 */
export async function postJsonOnce<P extends string>(path: P, body: ApiRequestBody<P>, fallbackError: string): Promise<any> {
  return readReply(await postOnce(`${getBaseUrl()}${path}`, body), fallbackError);
}

async function readReply(res: Response, fallbackError: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const reason = (!res.ok && data?.message) || data?.error || (res.ok ? fallbackError : `${fallbackError} (status ${res.status})`);
    throw new HttpError(reason, res.status, data);
  }
  return data;
}
