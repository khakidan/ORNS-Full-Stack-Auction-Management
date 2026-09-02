# Testing Philosophy & Quality Standards

This project follows the core testing principles pioneered by Kent C. Dodds and the React Testing Library team. 

Our guiding goal: **"The more your tests resemble the way your software is used, the more confidence they can give you."**

---

## 1. Test Quality Rating Scale

Every unit or integration test in this codebase must be evaluated against these strict quality categories. Avoid shallow or circular mocks.

### Category: GOOD (Target Standard)
The test simulates user actions directly and asserts on a tangible, user-visible outcome. If a developer breaks the core functionality, the test immediately fails. Refactoring internal implementation details without changing the user outcome will not break the test.

### Category: SHALLOW (Avoid)
The test only checks that an internal hook or function was called, rather than confirming *what* it was called with. This passes even if corrupt or invalid data is dispatched.
*   *Correction*: Always verify the exact payload parameters passed to mocked APIs or callbacks.

### Category: CIRCULAR (Avoid)
The test configures a mock to return a static value, then asserts that the component returns that exact value. The test can never fail and provides zero safety.
*   *Correction*: Use real state synchronization or query actual rendered text.

### Category: SMOKE (Use Sparingly)
The test merely asserts that a component does not throw on mount, or that a single high-level heading is visible. It fails to verify interactive states.

---

## 2. The Seam Test Standard

Verify the interface boundary between UI actions and the database service layer:
1. Render the real, unmocked React component.
2. Simulate realistic user interactions (e.g., text inputs, button clicks) using `fireEvent` or `@testing-library/user-event`.
3. Assert that the precise payload dispatched to the API seam matches the expected values.

---

## 3. Mocking Boundaries

### Acceptable to Mock
- Outbound network/HTTP calls (using `supertest` and `MSW`).
- Global React Context hooks when testing sub-components isolated from the main providers.
- Sandbox-incompatible browser-native APIs (e.g., local storage, geo-location, window redirection).

### Forbidden to Mock
- The primary system function/method currently being asserted.
- Isolated, pure helper utilities.

---

## 4. Recognized Benign Terminal Warnings

The following warnings can be ignored during test runs:
- **Bidders Tab SVG Warning**: `In HTML, <svg> cannot be a child of <select>...` (triggered by React select wrappers).
- **AuctionItemsTab Layout Warning**: `Received true for a non-boolean attribute layout...` (triggered by Framer Motion styling attributes on tables).
