/**
 * Verifies each of the six routers that were converted from 27 hand-copied
 * `if (!req.session?.tokens) return res.status(401)...` checks to a single
 * `router.use(requireAuth)` call still genuinely guards its own routes -
 * in isolation, not mounted alongside the others the way app.ts does.
 *
 * That isolation matters: app.ts mounts both bidRoutes.ts and
 * dataRoutes.ts at the same "/api" base path, with bidRoutes.ts first.
 * `router.use(requireAuth)` with no path applies to every request that
 * enters that router regardless of whether a specific route inside it
 * matches - so bidRoutes.ts's guard was found (while developing this
 * fix) to silently intercept and mask requests actually destined for
 * dataRoutes.ts, making it possible to accidentally remove
 * dataRoutes.ts's own guard without routes.test.ts's existing
 * `/api/sheets/:spreadsheetId/:range` 401 test ever noticing (bidRoutes.ts
 * returned 401 first either way). Mounting each router alone here removes
 * that masking and pins each one's own guard directly.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import createBundleRouter from "../routes/bundleRoutes";
import createSetupRouter from "../routes/setupRoutes";
import createBidRouter from "../routes/bidRoutes";
import createDataRouter from "../routes/dataRoutes";
import createProductionRouter from "../routes/productionRoutes";
import createReceiptsRouter from "../routes/receiptRoutes";

function isolatedApp(router: express.Router, basePath = "/api") {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return app;
}

describe("requireAuth - each router guards its own routes in isolation", () => {
  it("bundleRoutes.ts: POST /suggest-names returns 401 with no session", async () => {
    const app = isolatedApp(createBundleRouter());
    const res = await request(app).post("/api/suggest-names").send({ items: [] });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("setupRoutes.ts: POST /setup-new returns 401 with no session", async () => {
    const app = isolatedApp(createSetupRouter(), "/api/auction");
    const res = await request(app).post("/api/auction/setup-new").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("bidRoutes.ts: POST /auction/record-winning-bid returns 401 with no session", async () => {
    const app = isolatedApp(createBidRouter());
    const res = await request(app).post("/api/auction/record-winning-bid").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("dataRoutes.ts: GET /sheets/:spreadsheetId/:range returns 401 with no session", async () => {
    const app = isolatedApp(createDataRouter());
    const res = await request(app).get("/api/sheets/ss-id/Sheet1!A1:B2");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("productionRoutes.ts: POST /item-entry/bundling-doc returns 401 with no session", async () => {
    const app = isolatedApp(createProductionRouter(), "/api/production");
    const res = await request(app).post("/api/production/item-entry/bundling-doc").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("receiptRoutes.ts: POST /generate returns 401 with no session", async () => {
    const app = isolatedApp(createReceiptsRouter(), "/api/receipts");
    const res = await request(app).post("/api/receipts/generate").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });
});
