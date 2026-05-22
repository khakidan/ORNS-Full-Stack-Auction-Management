import { google } from "googleapis";

// Global resilient retry matrix for API calls
google.options({
  retryConfig: {
    retry: 4,
    retryDelay: 1000,
    httpMethodsToRetry: ['GET', 'PUT', 'HEAD', 'OPTIONS', 'DELETE', 'POST', 'PATCH'],
    statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],
  }
});
