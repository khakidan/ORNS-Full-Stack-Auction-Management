/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initErrorCapture, recordError, getErrorBuffer, __resetErrorCaptureForTests } from "./errorBuffer";

describe("errorBuffer", () => {
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    __resetErrorCaptureForTests();
    originalError = console.error;
    originalWarn = console.warn;
  });

  afterEach(() => {
    console.error = originalError;
    console.warn = originalWarn;
    __resetErrorCaptureForTests();
  });

  it("patches console.error to both record into the buffer and still call through to the original", () => {
    const spy = vi.fn();
    console.error = spy;
    initErrorCapture();

    console.error("Something broke", { code: 500 });

    expect(spy).toHaveBeenCalledWith("Something broke", { code: 500 });
    const buffer = getErrorBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].level).toBe("error");
    expect(buffer[0].message).toContain("Something broke");
  });

  it("patches console.warn the same way", () => {
    const spy = vi.fn();
    console.warn = spy;
    initErrorCapture();

    console.warn("Deprecated call");

    expect(spy).toHaveBeenCalledWith("Deprecated call");
    expect(getErrorBuffer()[0]).toMatchObject({ level: "warn", message: "Deprecated call" });
  });

  it("is idempotent - calling initErrorCapture twice does not double-patch console.error", () => {
    initErrorCapture();
    initErrorCapture();

    console.error("only once");

    expect(getErrorBuffer()).toHaveLength(1);
  });

  it("caps the buffer at 20 entries, dropping the oldest first", () => {
    initErrorCapture();

    for (let i = 0; i < 25; i++) {
      console.error(`entry ${i}`);
    }

    const buffer = getErrorBuffer();
    expect(buffer).toHaveLength(20);
    expect(buffer[0].message).toBe("entry 5");
    expect(buffer[19].message).toBe("entry 24");
  });

  it("captures a window 'error' event (outside the normal render path)", () => {
    initErrorCapture();

    const err = new Error("boom");
    const event = new ErrorEvent("error", { error: err, message: err.message });
    window.dispatchEvent(event);

    const buffer = getErrorBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].message).toContain("boom");
  });

  it("captures an 'unhandledrejection' event", () => {
    initErrorCapture();

    const event = Object.assign(new Event("unhandledrejection"), { reason: new Error("rejected") });
    window.dispatchEvent(event);

    const buffer = getErrorBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].message).toContain("rejected");
  });

  it("exposes a manual recordError() that any error boundary can call directly", () => {
    initErrorCapture();

    recordError("Caught by boundary");

    expect(getErrorBuffer()).toEqual([
      expect.objectContaining({ level: "error", message: "Caught by boundary" }),
    ]);
  });
});
