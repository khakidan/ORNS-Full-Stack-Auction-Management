/**
 * @vitest-environment jsdom
 *
 * Regression guard for the "no client-side error boundary anywhere"
 * finding from the hardening audit (docs/agents/refactor-opportunities.md's
 * Code Hardening item #1 / CHANGELOG.md) - before this, a render-time
 * exception anywhere in the tree white-screened the entire app with no
 * recovery path.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import * as errorBuffer from "@/lib/errorBuffer";

function Bomb(): never {
  throw new Error("Boom from a child component");
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error to console.error on its own - silence
    // that noise for this test file without hiding a genuine assertion
    // failure.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>Everything is fine</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });

  it("catches a render error from a descendant and shows the fallback UI instead of white-screening", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Boom from a child component")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Page" })).toBeInTheDocument();
  });

  it("records the caught error into the same ring buffer a bug report's console-activity section reads from", () => {
    const recordErrorSpy = vi.spyOn(errorBuffer, "recordError");

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(recordErrorSpy).toHaveBeenCalledWith("Error: Boom from a child component");
  });

  it("reloads the page when the Reload button is clicked", () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload Page" }));
    expect(reloadSpy).toHaveBeenCalled();

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
