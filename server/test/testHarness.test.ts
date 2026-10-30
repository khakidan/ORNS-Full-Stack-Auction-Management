import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

// setup.ts binds a bare listen(0) to 127.0.0.1 (ROADMAP T14).
describe("the test harness's own servers", () => {
  it("supertest's app server listens on 127.0.0.1, where it sends its requests, so no other process's port can answer", async () => {
    const app = express().get("/where", (req, res) => res.json({ local: req.socket.localAddress }));
    const res = await request(app).get("/where");
    expect(res.body.local).toBe("127.0.0.1");
  });
});
