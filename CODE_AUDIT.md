# Codebase Quality Audit Report

## 1. Executive Summary
The codebase is a monolithic Express-based backend with a React frontend, primarily orchestrated through a massive `server.ts` file (~2900 lines). While it implements complex transactional logic for Google Sheets and Apps Script integration, the architectural design severely impacts maintainability, testability, and scalability. The project suffers from significant technical debt due to the lack of modularity and absence of automated testing.

## 2. Orphaned & Dead Code
- **Deprecated Routes:** Several commented-out route definitions, such as those referencing `/api/bidders/walk-in` (around `server.ts:552`), indicate leftover, unused logic.
- **Potentially Unused Helper Functions:** Several helper functions within `server.ts` and external scripts seem to have grown over time, with remnants of unused functionality for deprecated sheet structures.
- **Redundant Exports:** Need a thorough audit of `email-helpers.ts` and `types.ts` to identify exports no longer consumed by any component.

## 3. Architectural & Style Inconsistencies
- **Monolithic `server.ts`:** This is the primary issue. Business logic, route handlers, Google API clients, and database-like operations (transactional sheet updates) are all tightly coupled in a single file. This makes navigation and debugging extremely difficult.
- **Duplicated Logic:** transactional logic for Google Sheets (fetching, updating, staging, rolling back) is implemented in multiple places with slight variations, increasing the risk of inconsistent behavior.
- **Inconsistent Error Handling:** Errors are handled sometimes with `res.status(500).json(...)`, sometimes with console logging only, and sometimes with re-throwing. A centralized error handling middleware would improve consistency and security.
- **Mixing Concerns:** Business logic (like `getCategoryBase`) is mixed with Express route handlers, instead of being extracted into separate services or utility modules.

## 4. Recommended Testing Plan & High-Risk Areas
The following workflows are critical and currently lack automated verification:

1. **Transactional Google Sheets Logic (`executeGoogleSheetsTransaction`):**
   - **Risk:** High (Data corruption if rollback fails).
   - **Test Cases:**
     - Successfully update rows.
     - Rollback on failure.
     - Handle `429` (Too Many Requests) errors.
2. **Auction Setup & Sync (`/api/auction/setup-new` and `performSheetSync`):**
   - **Risk:** Extreme (Broken auction state if setup fails mid-way).
   - **Test Cases:** Folder creation, template copying, sheet clearance/reset workflows.
3. **Receipt Generation & Emailing:**
   - **Risk:** Medium (Customer impact if emails are wrong/failed).
   - **Test Cases:** Validate email processing logic, mock Apps Script successful and failed responses.
4. **Idempotency Logic:**
   - **Risk:** Medium (Double purchases or duplicate transactions).
   - **Test Cases:** Test simultaneous duplicate requests for `record-winning-bid`.

## 5. Quick-Win Refactoring Actions
- [ ] **Extract Services:** Start by moving Sheets transactional logic, Apps Script calls, and Google Drive operations into a `/server/services` directory.
- [ ] **Introduce Middleware:** Implement a centralized error-handling middleware to replace individual `try-catch` JSON responses.
- [ ] **Split `server.ts`:** Begin separating routes into modules (e.g., `/server/routes/auth.ts`, `/server/routes/auction.ts`).
- [ ] **Implement Unit Tests:** Set up a basic Jest/Vitest suite and start with the most critical transaction-rollback logic.
- [ ] **Remove Dead Code:** Delete commented-out code and thoroughly audit imports in `server.ts` to remove unused references.
