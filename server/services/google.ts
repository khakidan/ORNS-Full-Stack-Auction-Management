import { google } from "googleapis";
import { RETRY_STATUS_CODES } from "../utils/googleRetry";

// Global retry policy for every Google API call. POST is deliberately
// NOT retried by default (ROADMAP.md M5): most of this app's POSTs -
// values.append (walk-ins, Follow-Up rows), spreadsheets.batchUpdate
// (insert rows/sheets), Gmail send, Apps Script runs - aren't idempotent,
// so retrying one after a 5xx that Google had in fact already applied
// would add a second row or send a second email. The safe ones opt back
// in with IDEMPOTENT_POST_RETRY (server/utils/googleRetry.ts).
google.options({
  retryConfig: {
    retry: 4,
    retryDelay: 1000,
    httpMethodsToRetry: ['GET', 'PUT', 'HEAD', 'OPTIONS', 'DELETE', 'PATCH'],
    statusCodesToRetry: RETRY_STATUS_CODES,
  }
});
