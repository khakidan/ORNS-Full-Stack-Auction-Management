import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

const mockRunPaypalSweep = vi.fn();
vi.mock("../services/paypalSweeperJob", () => ({
  runPaypalSweep: (...args: unknown[]) => mockRunPaypalSweep(...args),
  getSweeperStatus: vi.fn(),
  persistSweeperCredential: vi.fn(),
}));

import { app } from "../app";

describe("POST /internal/paypal-sweep (Cloud Scheduler)", () => {
  const original = process.env.SWEEPER_TRIGGER_SECRET;
  beforeEach(() => {
    mockRunPaypalSweep.mockReset().mockResolvedValue({ pending: 0, resolved: 0, escalated: 0 });
    process.env.SWEEPER_TRIGGER_SECRET = "test-secret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SWEEPER_TRIGGER_SECRET;
    else process.env.SWEEPER_TRIGGER_SECRET = original;
  });

  it("runs a scheduled sweep with the right secret, no session needed", async () => {
    const res = await request(app).post("/internal/paypal-sweep").set("X-Sweeper-Secret", "test-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 0, resolved: 0, escalated: 0 });
    expect(mockRunPaypalSweep).toHaveBeenCalledWith("scheduler");
  });

  it("401s on a missing or wrong secret without sweeping", async () => {
    expect((await request(app).post("/internal/paypal-sweep")).status).toBe(401);
    expect((await request(app).post("/internal/paypal-sweep").set("X-Sweeper-Secret", "nope")).status).toBe(401);
    expect(mockRunPaypalSweep).not.toHaveBeenCalled();
  });

  it("doesn't exist when SWEEPER_TRIGGER_SECRET isn't set (local development)", async () => {
    delete process.env.SWEEPER_TRIGGER_SECRET;
    const res = await request(app).post("/internal/paypal-sweep").set("X-Sweeper-Secret", "");
    expect(res.status).toBe(404);
    expect(mockRunPaypalSweep).not.toHaveBeenCalled();
  });
});
