import express from "express";

const processedRequests = new Map<string, { timestamp: number, response: any }>();

// Cleanup old requests every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of processedRequests.entries()) {
    if (now - value.timestamp > 3600000) { // 1 hour TTL
      processedRequests.delete(key);
    }
  }
}, 600000);

export function checkIdempotency(req: express.Request, res: express.Response, key: string) {
  if (key && processedRequests.has(key)) {
    const cached = processedRequests.get(key);
    console.log(`[Idempotency] Request already processed: ${key}`);
    return res.json({ ...cached?.response, duplicated: true });
  }
  return null;
}

export function saveIdempotency(key: string, response: any) {
  if (key) {
    processedRequests.set(key, { timestamp: Date.now(), response });
  }
}
