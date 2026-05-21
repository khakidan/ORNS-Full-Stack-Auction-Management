# Engineering Refactoring Roadmap: Auction App Stability

## Dev Manager's Strategy
Our priority is absolute stability during live auctions. We will adopt a "strangler fig" pattern: we will not rewrite the monolith. Instead, we will peel off small, isolated pieces of functionality into new, modular files one by one. If a move doesn't work, we revert it instantly.

## Phase 1: The "Zero-Risk" Cleanup
*Goal: Remove clutter that causes confusion for developers.*
- [ ] **Action:** Completely remove the commented-out code identified in `server.ts` regarding `/api/bidders/walk-in`.
- [ ] **Action:** Run `npm run lint` and `npm run build` to ensure the app still compiles perfectly.
- [ ] **Commit:** Commit this strictly as a "Cleanup: Remove dead route" commit.

## Phase 2: Setting up the Architecture
*Goal: Create the structure to hold new modular code.*
Create the following directory structure in `/server`:
```text
/server
  /routes       # Isolated Express route handlers
  /services     # Core business logic (Sheets, PayPal API)
  /middleware   # Express middleware (Error handling, Auth)
  /utils        # Pure helper functions
```

## Phase 3: The First Micro-Refactor
*Goal: Extract one route handler as a proof of concept.*
**Task:** Identify the existing `GET /api/health` route in `server.ts` and move it to `/server/routes/health.ts`.

**Before (`server.ts`):**
```typescript
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});
```

**After (`server/routes/health.ts`):**
```typescript
import { Router } from 'express';
const router = Router();
router.get("/", (req, res) => res.json({ status: "ok" }));
export default router;
```

**After (`server.ts` imports/usage):**
```typescript
import healthRouter from './server/routes/health';
app.use("/api/health", healthRouter);
```

## Phase 4: The Central Error Middleware
*Goal: Stop individual route handlers from manually managing 500-level errors.*

**Boilerplate (`server/middleware/errorHandler.ts`):**
```typescript
import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error("Centralized Error:", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
}
```

**Plugging into `server.ts` (Last line before `app.listen()`):**
```typescript
import { errorHandler } from './server/middleware/errorHandler';
// ... all routes
app.use(errorHandler);
```
