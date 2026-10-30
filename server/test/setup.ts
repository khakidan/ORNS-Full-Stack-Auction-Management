import { setupServer } from 'msw/node'
import { handlers } from './handlers'
import { beforeAll, afterAll, afterEach, vi } from 'vitest'

// jsdom has no pointer capture or scrollIntoView; the real Base UI Select
// and Dialog call them. Frontend tests use the real primitives (ROADMAP T6).
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
}

// No test reaches real Firestore: without this, an unmocked read (the
// Config, a role) went out over the network with whatever Google
// credentials the machine had. Every test gets an empty in-memory
// Firestore, cleared after each test; a test file that needs data mocks
// firebaseAdmin with its own (helpers/fakeFirestore.ts), which wins.
vi.mock('../services/firebaseAdmin', async () => {
  const { createFakeFirestore } = await import('./helpers/fakeFirestore')
  const fake = createFakeFirestore()
  return { getAdminFirestore: () => fake.db, _clearDefaultFakeFirestore: () => fake.clear() }
})
afterEach(async () => {
  const admin: any = await import('../services/firebaseAdmin')
  // A file's own firebaseAdmin mock has no such export (vitest throws on the lookup).
  try { admin._clearDefaultFakeFirestore() } catch { /* not the default fake */ }
  const { _resetConfigCacheForTesting } = await import('../services/configService')
  _resetConfigCacheForTesting()
  // Sheet reads the server cached (5 s) mustn't answer the next test.
  const { sheetCache } = await import('../utils/sheetCache')
  sheetCache.clear()
})

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
// Every logged route records to the Action History spreadsheet
// (actionLog.ts). Tests never reach it: logAction is a spy that route tests
// can inspect, and actionLog.test.ts covers the real module via
// vi.importActual.
vi.mock('../services/actionLog', () => ({
  logAction: vi.fn(async () => {}),
  logSystemAction: vi.fn(async () => {}),
}))
afterEach(async () => {
  const { logAction, logSystemAction } = await import('../services/actionLog')
  vi.mocked(logAction).mockClear()
  vi.mocked(logSystemAction).mockClear()
})

// Bidders follow their tickets (bidderTicketSync.ts): many routes run the
// sync first. Tests never reach it unless they say so - it's a spy here,
// and bidderTicketSync.test.ts covers the real module via vi.importActual.
vi.mock('../services/bidderTicketSync', () => ({
  syncBiddersFromTickets: vi.fn(async () => ({ renamed: [], added: [], unlinked: [] })),
  BACKGROUND_SYNC_INTERVAL_MS: 60000,
}))

// Where the Action History spreadsheet is (Firestore system/actionHistory).
// Not set up unless a test says otherwise; actionHistoryStore.test.ts
// covers the real module via vi.importActual.
vi.mock('../services/actionHistoryStore', () => {
  const undone = new Set<string>()
  let editTracking: unknown = null
  return {
    getActionHistorySpreadsheetId: vi.fn(async () => ''),
    setActionHistorySpreadsheetId: vi.fn(async () => {}),
    wasUndone: vi.fn(async (id: string) => undone.has(id)),
    recordUndone: vi.fn(async (id: string) => { undone.add(id) }),
    getEditTrackingRecord: vi.fn(async () => editTracking),
    setEditTrackingRecord: vi.fn(async (record: unknown) => { editTracking = record }),
    _resetActionHistoryStoreForTesting: () => { undone.clear(); editTracking = null },
  }
})
afterEach(async () => {
  const store = await import('../services/actionHistoryStore')
  store._resetActionHistoryStoreForTesting()
})

// Closing the auction ends every volunteer's access (Firestore). Route tests
// get a spy instead; volunteers.test.ts covers the real function.
vi.mock('../services/volunteerService', async (importActual) => ({
  ...(await importActual<typeof import('../services/volunteerService')>()),
  deactivateAllVolunteers: vi.fn(async () => 0),
}))

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
