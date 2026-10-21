// Kept apart from server/services/google.ts, which sets the global
// policy as an import side effect, so services can import this constant
// without pulling that in (tests mock googleapis wholesale).
export const RETRY_STATUS_CODES: [number, number][] = [[100, 199], [429, 429], [500, 599]];

/**
 * Per-call options that DO retry a POST - only for calls that are safe to
 * repeat, i.e. that set cells to absolute values or clear them
 * (values.batchUpdate, values.clear): applying one twice leaves the sheet
 * exactly as applying it once. Pass as the call's second argument.
 */
export const IDEMPOTENT_POST_RETRY = {
  retryConfig: {
    retry: 4,
    retryDelay: 1000,
    httpMethodsToRetry: ['POST'],
    statusCodesToRetry: RETRY_STATUS_CODES,
  },
};
