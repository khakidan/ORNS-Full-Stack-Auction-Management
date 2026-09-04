import { describe, it, expect, vi, afterEach } from "vitest";
import { cacheControl } from "../middleware/cacheControl";
import { cookiePolicy } from "../middleware/cookiePolicy";
import { tokenRestorer } from "../middleware/tokenRestorer";
import { errorHandler } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/requireAuth";
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

  it("A request to /api (no trailing slash) — does not set Cache-Control header", () => {
    const { req, res, next } = createMocks("/api");
    cacheControl(req, res, next);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("A request to /api/sheets/something/deep/nested — sets Cache-Control header", () => {
    const { req, res, next } = createMocks("/api/sheets/something/deep/nested");
    cacheControl(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
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

  it("A host containing ais-dev- is treated as an iframe in production — sameSite=none", () => {
    process.env.NODE_ENV = "production";
    const { req, res, next } = createMocks("/test", "ais-dev-app.com");
    const reqWithSession = req as unknown as { sessionOptions: Record<string, unknown> };
    reqWithSession.sessionOptions = {};
    cookiePolicy(req, res, next);
    expect(reqWithSession.sessionOptions.secure).toBe(true);
    expect(reqWithSession.sessionOptions.sameSite).toBe("none");
    expect(next).toHaveBeenCalled();
  });

  it("A host containing ais-pre- is treated as an iframe in production — sameSite=none", () => {
    process.env.NODE_ENV = "production";
    const { req, res, next } = createMocks("/test", "ais-pre-app.com");
    const reqWithSession = req as unknown as { sessionOptions: Record<string, unknown> };
    reqWithSession.sessionOptions = {};
    cookiePolicy(req, res, next);
    expect(reqWithSession.sessionOptions.secure).toBe(true);
    expect(reqWithSession.sessionOptions.sameSite).toBe("none");
    expect(next).toHaveBeenCalled();
  });

  it("A request where sec-fetch-dest is iframe but host is plain localhost — sameSite=lax in development", () => {
    process.env.NODE_ENV = "development";
    const { req, res, next } = createMocks("/test", "localhost");
    const reqWithSession = req as unknown as { get: (n: string) => string | undefined; sessionOptions: Record<string, unknown> };
    reqWithSession.sessionOptions = {};
    reqWithSession.get = vi.fn((name: string) => {
       if (name.toLowerCase() === "host") return "localhost";
       if (name.toLowerCase() === "sec-fetch-dest") return "iframe";
       return undefined;
    });
    cookiePolicy(req, res, next);
    expect(reqWithSession.sessionOptions.secure).toBe(false);
    expect(reqWithSession.sessionOptions.sameSite).toBe("lax");
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

  it("A header containing valid JSON where the parsed value is null — tokens not written", () => {
    const { req, res, next } = createMocks();
    req.headers["x-google-tokens"] = "null";
    tokenRestorer(req, res, next);
    expect(req.session).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("A header containing valid JSON that is an array (e.g. []) rather than an object — asserts that req.session.tokens is NOT set when the header contains an array, and that next() is still called", () => {
    const { req, res, next } = createMocks();
    req.headers["x-google-tokens"] = "[]";
    tokenRestorer(req, res, next);
    expect(req.session?.tokens).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("A header containing valid JSON false — tokens not written", () => {
    const { req, res, next } = createMocks();
    req.headers["x-google-tokens"] = "false";
    tokenRestorer(req, res, next);
    expect(req.session).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("Tokens are written correctly with the exact value that was in the header", () => {
    const { req, res, next } = createMocks();
    const tokenObj = { access_token: "secret_123", expiry_date: 456 };
    req.headers["x-google-tokens"] = JSON.stringify(tokenObj);
    tokenRestorer(req, res, next);
    expect(req.session).toBeDefined();
    expect(req.session!.tokens).toEqual(tokenObj);
    expect(next).toHaveBeenCalled();
  });
});

describe("middleware - errorHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A thrown Error with a message returns status 500 with JSON body", () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = {} as Request;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn();

    const err = new Error("Something went wrong");
    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Internal Server Error",
      message: "Something went wrong"
    });
    expect(next).not.toHaveBeenCalled();
    expect(errorLogSpy).toHaveBeenCalledTimes(1);
    expect(errorLogSpy).toHaveBeenCalledWith("Centralized Error:", err);
  });

  it("A thrown Error with an empty message returns status 500 with an empty message field", () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = {} as Request;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn();

    const err = new Error("");
    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Internal Server Error",
      message: ""
    });
    expect(next).not.toHaveBeenCalled();
    expect(errorLogSpy).toHaveBeenCalledTimes(1);
    expect(errorLogSpy).toHaveBeenCalledWith("Centralized Error:", err);
  });

  it("A thrown Error with special characters in the message returns the message unchanged", () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = {} as Request;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn();

    const err = new Error("<script>alert('hello')</script> \"quotes\"");
    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Internal Server Error",
      message: "<script>alert('hello')</script> \"quotes\""
    });
    expect(next).not.toHaveBeenCalled();
    expect(errorLogSpy).toHaveBeenCalledTimes(1);
    expect(errorLogSpy).toHaveBeenCalledWith("Centralized Error:", err);
  });
});

describe("middleware - requireAuth", () => {
  function createAuthMocks(session: any) {
    const req = { session } as unknown as Request;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn();
    return { req, res, next, jsonMock };
  }

  it("calls next() and does not respond when session tokens are present", () => {
    const { req, res, next, jsonMock } = createAuthMocks({ tokens: { access_token: "abc" } });

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it("returns 401 Unauthorized and does not call next() when session is null", () => {
    const { req, res, next, jsonMock } = createAuthMocks(null);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 Unauthorized and does not call next() when session exists but has no tokens", () => {
    const { req, res, next, jsonMock } = createAuthMocks({});

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 Unauthorized when session is undefined", () => {
    const { req, res, next, jsonMock } = createAuthMocks(undefined);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});
