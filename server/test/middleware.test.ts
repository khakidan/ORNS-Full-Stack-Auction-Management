import { describe, it, expect, vi, afterEach } from "vitest";
import { cacheControl } from "../middleware/cacheControl";
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

  it("Respects a real status set on the error (e.g. body-parser's 413 PayloadTooLargeError), instead of forcing 500", () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = {} as Request;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn();

    const err = Object.assign(new Error("request entity too large"), { status: 413, type: "entity.too.large" });
    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Internal Server Error",
      message: "request entity too large"
    });
  });

  it("Also respects statusCode (not just status) - different middleware/libraries use either property", () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = {} as Request;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn();

    const err = Object.assign(new Error("bad request"), { statusCode: 400 });
    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
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
