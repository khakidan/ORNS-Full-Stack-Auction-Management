/**
 * ROADMAP.md L9: every response says the app may not be framed, plus the
 * other low-risk browser hardening headers. HSTS only on the deployed
 * HTTPS build.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createSecurityHeaders } from "../middleware/securityHeaders";

describe("security headers", () => {
  it("are set on API responses, including unauthenticated ones", async () => {
    const response = await request(app).get("/api/health");

    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("are set on a 404 too, not just on matched routes", async () => {
    const response = await request(app).get("/no-such-page");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("send HSTS only when asked to (the deployed HTTPS build)", () => {
    const setHeader = vi.fn();
    const next = vi.fn();

    createSecurityHeaders({ hsts: false })({} as any, { setHeader } as any, next);
    expect(setHeader.mock.calls.map((c) => c[0])).not.toContain("Strict-Transport-Security");

    setHeader.mockClear();
    createSecurityHeaders({ hsts: true })({} as any, { setHeader } as any, next);
    expect(setHeader).toHaveBeenCalledWith("Strict-Transport-Security", "max-age=31536000");
    expect(next).toHaveBeenCalledTimes(2);
  });
});
