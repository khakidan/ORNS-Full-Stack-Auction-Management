# Changelog

All notable changes to the **ORNS Charity Auction Manager** will be documented in this file.

## [Unreleased]

### Added
- Created a modular documentation system in `/docs/agents/` to break down the monolithic `AGENTS.md` and `README.md` files into organized subfiles.
- Added `/docs/agents/CHANGELOG.md` to track feature updates, bug fixes, and system improvements.
- Added `/docs/agents/ROADMAP.md` outlining future developments and system-wide structural proposals.
- Added `/docs/agents/file-reference.md` for full project topography and directory listings.
- Added `/docs/agents/patterns.md` detailing architectural guidelines, transactional patterns, and critical developer rules.
- Added `/docs/agents/schema.md` for sheets data integration schemas and column structures.
- Added `/docs/agents/style_guide.md` specifying design philosophy, bundle optimizations, and tailwind typography.
- Added `/docs/agents/testing-batches.md` explaining Sandbox-safe Vitest partitioning.
- Added `/docs/agents/testing-philosophy.md` enforcing rigorous quality rating criteria (GOOD, SHALLOW, CIRCULAR, SMOKE) and mock limits.

### Changed
- Moved `README.md` to `/docs/agents/README.md` to consolidate the overall system architecture guidance.
- Moved `USER_GUIDE.md` to `/docs/agents/USER_GUIDE.md` and updated structural references to point staff and operators directly to the new directory.
- Merged all modular directory lists and metadata links from the redundant `/docs/agents/AGENTS.md` file back into the primary root `/AGENTS.md` index file, and safely deleted `/docs/agents/AGENTS.md` to eliminate configuration duplication.
- Strengthened mock-assertion validation for Gemini genAI endpoints inside `/server/test/bundle.test.ts`. Converted three CIRCULAR test cases ("AI name suggestions — happy path", "AI description suggestion — happy path", and "Happy path — returns AI response text") into GOOD test cases asserting deep prompt checks.
- Cleaned up obsolete tests in `/server/test/items.test.ts` to maintain high-quality testing standards (removed UI-only canceled action checking and empty single-item selection checks).
- Updated documentation across `AGENTS.md` to accurately reflect a test count of 321 passing tests (233 backend, 88 frontend).

