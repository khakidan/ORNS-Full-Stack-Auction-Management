import { describe, it, expect, vi, afterEach } from "vitest";
import { cacheControl } from "../middleware/cacheControl";
import { cookiePolicy } from "../middleware/cookiePolicy";
import { tokenRestorer } from "../middleware/tokenRestorer";
import { Request, Response } from "express";

// Typed Mock Helpers
interface MockRes {
  setHeader: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  [key: string]: any;
}

function createMocks(path = "/", host = "localhost") {
  const req = {
    path,
    headers: {},
    get: vi.fn((name: string) => {
      if (name.toLowerCase() === "host") return host;
      return undefined;
    }),
    session: undefined,
  } as unknown as Request & { session?: any };

  const res = {
    setHeader: vi.fn(),
  } as unknown as Response & MockRes;

  const next = vi.fn();

  return { req, res, next };
}

describe("middleware - cacheControl", () => {
  it("adds headers for /api/ routes", () => {
    const { req, res, next } = createMocks("/api/test");
    cacheControl(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    expect(next).toHaveBeenCalled();
  });

  it("adds headers for /auth/ routes", () => {
    const { req, res, next } = createMocks("/auth/callback");
    cacheControl(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    expect(next).toHaveBeenCalled();
  });

  it("does not add headers for root path", () => {
    const { req, res, next } = createMocks("/");
    cacheControl(req, res, next);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe("middleware - cookiePolicy", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("sets secure=true, sameSite=none for production iframe", () => {
    process.env.NODE_ENV = "production";
    const { req, res, next } = createMocks("/test", "ais-dev-app.com");
    (req as any).sessionOptions = {};
    (req as any).get = vi.fn((name: string) => {
       if (name.toLowerCase() === "host") return "ais-dev-app.com";
       if (name.toLowerCase() === "sec-fetch-dest") return "iframe";
       return undefined;
    });

    cookiePolicy(req, res, next);
    
    const sessionOptions = (req as any).sessionOptions;
    expect(sessionOptions.secure).toBe(true);
    expect(sessionOptions.sameSite).toBe("none");
    expect(next).toHaveBeenCalled();
  });

  it("sets secure=true, sameSite=lax for production top-level tab", () => {
    process.env.NODE_ENV = "production";
    const { req, res, next } = createMocks("/test", "myapp.com");
    (req as any).sessionOptions = {};
    
    cookiePolicy(req, res, next);

    const sessionOptions = (req as any).sessionOptions;
    expect(sessionOptions.secure).toBe(true);
    expect(sessionOptions.sameSite).toBe("lax");
    expect(next).toHaveBeenCalled();
  });

  it("sets secure=false, sameSite=lax for development", () => {
    process.env.NODE_ENV = "development";
    const { req, res, next } = createMocks("/test", "localhost");
    (req as any).sessionOptions = {};
    
    cookiePolicy(req, res, next);

    const sessionOptions = (req as any).sessionOptions;
    expect(sessionOptions.secure).toBe(false);
    expect(sessionOptions.sameSite).toBe("lax");
    expect(next).toHaveBeenCalled();
  });

  it("does nothing if sessionOptions is absent", () => {
    const { req, res, next } = createMocks();
    // req.sessionOptions is undefined by default in createMocks
    cookiePolicy(req, res, next);
    expect((req as any).sessionOptions).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe("middleware - tokenRestorer", () => {
  it("restores tokens from x-google-tokens header", () => {
    const { req, res, next } = createMocks();
    const tokens = { access_token: "abc" };
    req.headers["x-google-tokens"] = JSON.stringify(tokens);
    
    tokenRestorer(req, res, next);

    expect(req.session).toBeDefined();
    expect(req.session.tokens).toEqual(tokens);
    expect(next).toHaveBeenCalled();
  });

  it("initializes null session before writing", () => {
    const { req, res, next } = createMocks();
    req.session = null as any;
    req.headers["x-google-tokens"] = JSON.stringify({ test: 1 });

    tokenRestorer(req, res, next);

    expect(req.session).not.toBeNull();
    expect(req.session.tokens).toEqual({ test: 1 });
    expect(next).toHaveBeenCalled();
  });

  it("does not throw on malformed JSON and calls next()", () => {
    const { req, res, next } = createMocks();
    req.headers["x-google-tokens"] = "{ malformed }";
    
    // Silence error log for test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    tokenRestorer(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("passes through if x-google-tokens header is missing", () => {
    const { req, res, next } = createMocks();
    tokenRestorer(req, res, next);
    expect(req.session).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
