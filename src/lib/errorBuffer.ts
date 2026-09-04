import { BugReportConsoleEntry } from "@/types";

const MAX_ENTRIES = 20;

let buffer: BugReportConsoleEntry[] = [];
let initialized = false;
let windowErrorHandler: ((event: ErrorEvent) => void) | null = null;
let windowRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

function push(level: "error" | "warn", args: unknown[]) {
  const message = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  buffer.push({ level, message, timestamp: new Date().toISOString() });
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

/**
 * Records an error into the same ring buffer console.error/warn feed -
 * for any error boundary or global handler that catches an error outside
 * console's own reach to still show up in a bug report's "Recent console
 * activity" section.
 */
export function recordError(message: string) {
  push("error", [message]);
}

/** Read-only snapshot, oldest first - the buffer itself must stay private so nothing outside this module can mutate it directly. */
export function getErrorBuffer(): BugReportConsoleEntry[] {
  return [...buffer];
}

/** Test-only: clears state and tears down the window listeners so each test starts from a clean, re-initializable buffer. */
export function __resetErrorCaptureForTests() {
  buffer = [];
  initialized = false;
  if (typeof window !== "undefined") {
    if (windowErrorHandler) window.removeEventListener("error", windowErrorHandler);
    if (windowRejectionHandler) window.removeEventListener("unhandledrejection", windowRejectionHandler);
  }
  windowErrorHandler = null;
  windowRejectionHandler = null;
}

/**
 * Patches console.error/warn and window's global error hooks once, so
 * this module can rebuild "what just happened" context for a bug report
 * without asking the user to describe it themselves. Idempotent - safe to
 * call from multiple entry points (e.g. React StrictMode double-invoking
 * effects) without double-patching console methods.
 */
export function initErrorCapture() {
  if (initialized) return;
  initialized = true;

  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: unknown[]) => {
    push("error", args);
    originalError.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    push("warn", args);
    originalWarn.apply(console, args);
  };

  if (typeof window !== "undefined") {
    windowErrorHandler = (event) => {
      recordError(event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : event.message);
    };
    windowRejectionHandler = (event) => {
      const reason = event.reason;
      recordError(reason instanceof Error ? `Unhandled rejection: ${reason.name}: ${reason.message}` : `Unhandled rejection: ${String(reason)}`);
    };
    window.addEventListener("error", windowErrorHandler);
    window.addEventListener("unhandledrejection", windowRejectionHandler);
  }
}
