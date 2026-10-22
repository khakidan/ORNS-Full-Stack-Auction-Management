import { setupServer } from 'msw/node'
import { handlers } from './handlers'
import { beforeAll, afterAll, afterEach, vi } from 'vitest'

// PayPal sandbox/live is read from Firestore server-side (sharedConfig.ts,
// ROADMAP.md M3). Tests never reach real Firestore, so every test sees
// sandbox unless it overrides this mock; sharedConfig.test.ts covers the
// real module via vi.importActual.
vi.mock('../services/sharedConfig', () => ({
  getPaypalIsSandbox: vi.fn(async () => true),
  _resetSharedConfigForTesting: () => {},
}))

// Durable idempotency records (idempotencyStore.ts, Milestone A) live in
// Firestore. Tests get an in-memory stand-in, cleared after every test so
// one test's records can't leak into the next; idempotencyStore.test.ts
// covers the real module via vi.importActual.
vi.mock('../services/idempotencyStore', () => {
  const records = new Map<string, unknown>()
  return {
    DURABLE_TTL_MS: 24 * 60 * 60 * 1000,
    getStoredResult: vi.fn(async (fullKey: string) => (records.has(fullKey) ? { result: records.get(fullKey) } : undefined)),
    storeResult: vi.fn(async (fullKey: string, result: unknown) => { records.set(fullKey, result) }),
    _clearForTesting: () => records.clear(),
  }
})
import * as durableStore from '../services/idempotencyStore'
afterEach(() => (durableStore as any)._clearForTesting())

export const server = setupServer(...handlers)

// Start server before all tests
beforeAll(() => server.listen({ 
  // Allow local API requests (supertest), but error on unhandled external requests
  onUnhandledRequest(req) {
    const url = new URL(req.url);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return;
    }
    throw new Error(`Unhandled request to ${req.url}. Please add a handler to handlers.ts`);
  }
}))

//  Close server after all tests
afterAll(() => server.close())

// Reset handlers after each test `important for isolations`
afterEach(() => server.resetHandlers())
