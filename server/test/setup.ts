import { setupServer } from 'msw/node'
import { handlers } from './handlers'
import { beforeAll, afterAll, afterEach } from 'vitest'

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
