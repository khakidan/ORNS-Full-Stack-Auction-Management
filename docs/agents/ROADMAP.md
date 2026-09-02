# Project Roadmap & Structural Blueprint

This document outlines the high-level roadmap and future milestones of the **ORNS Charity Auction Manager**. Refactor and cleanup work - including the former "Frontend UI Audit & Component Unification Plan" that used to live here - now lives in [`refactor-opportunities.md`](./refactor-opportunities.md). This document is for net-new feature milestones only.

---

## Near-Term Milestones (Staging)

### Milestone A: Sync & Retry Resiliency
- Implement visual indicator banners within the frontend configuration header when Google Sheets syncing transactions are retrying in the background.
- Introduce client-side offline queues that buffer bid logs temporarily in local storage during brief network drops, then replay them with idempotency keys upon restoration.

### Milestone B: Advanced Reporting Dashboards
- Expand the analytics engine within `/src/components/Dashboard.tsx` to visualize bid distributions over time, total funds raised by category, and real-time checkout percentages via D3 charts.
