/**
 * @vitest-environment jsdom
 *
 * ConfigContext.tsx had zero test coverage - flagged as the highest-risk
 * untested file in the security-relevant category (Firestore config
 * sync, the @orns.org domain-enforcement, and the permission-denied
 * toast branch). It's also marked "DO NOT MODIFY... unless explicitly
 * ordered" in patterns.md.
 *
 * Writing these tests confirmed a real, already-logged bug: the
 * `useEffect`'s `return () => unsubConfig()` was returned from *inside*
 * the nested `onAuthStateChanged` callback, not from the effect's own
 * callback - Firebase ignores that return value entirely (it's not how
 * the effect-cleanup contract works for a nested callback), so the
 * Firestore config listener was never actually unsubscribed on
 * sign-out/re-sign-in or unmount. Per the user's explicit go-ahead (this
 * file needs permission before any edit), fixed by hoisting `unsubConfig`
 * to the effect's outer scope and tearing it down both before starting a
 * new listener on each auth-state change and in the effect's real
 * cleanup. The "does not leak the config listener" test below is the
 * regression guard for this exact fix.
 */
import React from "react";
import "@testing-library/jest-dom";
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigProvider, useConfig } from "./ConfigContext";
import { Config } from "@/types";

vi.mock("@/services/firebase", () => ({
  getFirebase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { getFirebase } from "@/services/firebase";
import { toast } from "sonner";

const mockedGetFirebase = vi.mocked(getFirebase);

const FAKE_CONFIG: Config = {
  auctionItemsSpreadsheetId: "items-id",
  auctionTicketsSpreadsheetId: "tickets-id",
  bidManagementSpreadsheetId: "bm-id",
  bidderNumbersSheet: "Bidder-Numbers",
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "receipt-folder",
  forPrintFolderId: "print-folder",
  ornsLogoId: "logo-id",
  ticketPrice: "35",
  auctionItemsScriptId: "items-script",
  auctionTicketsScriptId: "tickets-script",
  bidManagementScriptId: "bm-script",
  bugReportsSpreadsheetId: "bug-reports-id",
  bugReportsFolderId: "bug-reports-folder",
  paypalIsSandbox: true,
};

/**
 * Builds a fully controllable fake of getFirebase()'s resolved value,
 * with hooks to manually fire the auth-state and snapshot callbacks and
 * to inspect the unsubscribe spies each listener produced.
 */
function makeFirebaseMock() {
  let authCallback: ((user: any) => void) | null = null;
  const authUnsubscribe = vi.fn();

  let snapshotOnNext: ((snap: any) => void) | null = null;
  let snapshotOnError: ((err: any) => void) | null = null;
  const configUnsubscribe = vi.fn();

  const signInWithPopup = vi.fn();
  const signOut = vi.fn().mockResolvedValue(undefined);
  const setDoc = vi.fn().mockResolvedValue(undefined);
  const serverTimestamp = vi.fn(() => "SERVER_TIMESTAMP");
  const doc = vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") }));

  const onAuthStateChanged = vi.fn((_auth: any, callback: (user: any) => void) => {
    authCallback = callback;
    return authUnsubscribe;
  });

  const onSnapshot = vi.fn((_ref: any, onNext: (snap: any) => void, onError: (err: any) => void) => {
    snapshotOnNext = onNext;
    snapshotOnError = onError;
    return configUnsubscribe;
  });

  const services = {
    auth: {},
    db: {},
    GoogleAuthProvider: vi.fn().mockImplementation(function (this: any) { this.setCustomParameters = vi.fn(); }),
    onAuthStateChanged,
    signInWithPopup,
    signOut,
    doc,
    setDoc,
    onSnapshot,
    serverTimestamp,
  };

  return {
    services,
    // Simulates Firebase Auth reporting a sign-in/sign-out.
    fireAuthChange: (user: any) => authCallback!(user),
    // Simulates a Firestore document snapshot arriving.
    fireSnapshot: (snap: any) => snapshotOnNext!(snap),
    fireSnapshotError: (err: any) => snapshotOnError!(err),
    authUnsubscribe,
    configUnsubscribe,
    signInWithPopup,
    signOut,
    setDoc,
    doc,
    serverTimestamp,
  };
}

function renderConfigHook() {
  return renderHook(() => useConfig(), {
    wrapper: ({ children }) => <ConfigProvider>{children}</ConfigProvider>,
  });
}

describe("useConfig", () => {
  it("throws when used outside ConfigProvider", () => {
    expect(() => renderHook(() => useConfig())).toThrow("useConfig must be used within a ConfigProvider");
  });
});

describe("ConfigProvider - auth state and config sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("clears loading with default config when there is no signed-in user", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());

    act(() => fb.fireAuthChange(null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.firebaseUser).toBeNull();
  });

  it("subscribes to the global config doc and applies a real snapshot on sign-in", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());

    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalled());

    act(() => fb.fireSnapshot({ exists: () => true, data: () => FAKE_CONFIG }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual(FAKE_CONFIG);
    expect(result.current.firebaseUser).toEqual({ email: "staff@orns.org" });

    // Mirrors every config field to localStorage, plus the two legacy keys.
    expect(localStorage.getItem("auctionItemsSpreadsheetId")).toBe("items-id");
    expect(localStorage.getItem("spreadsheetId")).toBe("bm-id");
    expect(localStorage.getItem("googleScriptId")).toBe("bm-script");
  });

  it("defaults a newly-added Config field to '' instead of undefined, for a Firestore doc saved before that field existed", async () => {
    // Regression guard: adding bugReportsSpreadsheetId/bugReportsFolderId
    // to the Config type doesn't retroactively add them to already-saved
    // Firestore documents. A blind `docSnap.data() as Config` cast used
    // to leave them `undefined` at runtime, which tripped Base UI's
    // uncontrolled-to-controlled warning on that field's Input the first
    // time an existing user opened Settings after this field was added.
    const { bugReportsSpreadsheetId, bugReportsFolderId, ...oldShapeConfig } = FAKE_CONFIG;
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalled());

    act(() => fb.fireSnapshot({ exists: () => true, data: () => oldShapeConfig }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Asserting typeof "string" rather than a literal "" deliberately -
    // defaultConfig's own fallback chain (localStorage, then a real
    // VITE_BUG_REPORTS_SPREADSHEET_ID env var this machine may have set)
    // legitimately decides the exact value; the actual bug being guarded
    // against is `undefined`, not "whatever the real default happens to
    // resolve to on this machine".
    expect(typeof result.current.config.bugReportsSpreadsheetId).toBe("string");
    expect(typeof result.current.config.bugReportsFolderId).toBe("string");
    // Every field the old doc DID have must still come through untouched.
    expect(result.current.config.auctionItemsSpreadsheetId).toBe("items-id");
  });

  it("shows the @orns.org permission-denied toast and clears loading on a Firestore permission error", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());
    act(() => fb.fireAuthChange({ email: "someone@gmail.com" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalled());

    act(() => fb.fireSnapshotError({ code: "permission-denied", message: "denied" }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(toast.error).toHaveBeenCalledWith("Permission denied: Sync is only available for @orns.org users.");
  });

  it("does not show the permission toast for other Firestore error codes", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalled());

    act(() => fb.fireSnapshotError({ code: "unavailable", message: "network down" }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not leak the config listener across a sign-out/re-sign-in cycle (regression guard)", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());

    // First sign-in creates a config listener.
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalledTimes(1));
    const firstUnsub = fb.configUnsubscribe;

    // Sign-out must tear down that listener - not leave it running forever.
    act(() => fb.fireAuthChange(null));
    expect(firstUnsub).toHaveBeenCalledTimes(1);

    // Re-sign-in creates a second listener.
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalledTimes(2));

    // Signing out again must tear down THIS (second) listener too - proves
    // the fix isn't just a one-shot cleanup, it re-arms every cycle. The
    // mock's onSnapshot always returns the same spy instance, so two full
    // sign-out cycles means two cumulative calls.
    act(() => fb.fireAuthChange(null));
    expect(fb.configUnsubscribe).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes both listeners on unmount", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { unmount } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(fb.services.onSnapshot).toHaveBeenCalled());

    unmount();

    expect(fb.authUnsubscribe).toHaveBeenCalledTimes(1);
    expect(fb.configUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("ConfigProvider - loginToFirebase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("signs in successfully with an @orns.org account and does not sign back out", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);
    fb.signInWithPopup.mockResolvedValue({ user: { email: "staff@orns.org" } });

    const { result } = renderConfigHook();
    await act(async () => {
      await result.current.loginToFirebase();
    });

    expect(fb.signInWithPopup).toHaveBeenCalled();
    expect(fb.signOut).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("restricts and signs back out a non-@orns.org account", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);
    fb.signInWithPopup.mockResolvedValue({ user: { email: "someone@gmail.com" } });

    const { result } = renderConfigHook();
    await act(async () => {
      await result.current.loginToFirebase();
    });

    expect(toast.error).toHaveBeenCalledWith("Access restricted: Please use an @orns.org account.");
    expect(fb.signOut).toHaveBeenCalled();
  });

  it("shows a generic error toast (not a crash) when sign-in itself fails", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);
    fb.signInWithPopup.mockRejectedValue(new Error("popup closed"));

    const { result } = renderConfigHook();
    await act(async () => {
      await result.current.loginToFirebase();
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to sign in to sync service.");
  });
});

describe("ConfigProvider - saveConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("refuses to save and shows an error toast when no one is signed in", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await act(async () => {
      await result.current.saveConfig(FAKE_CONFIG);
    });

    expect(fb.setDoc).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("You must be signed in to save shared settings.");
  });

  it("writes to the real settings/global doc with updatedBy/updatedAt, updates local config, and shows success", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(result.current.firebaseUser).toEqual({ email: "staff@orns.org" }));

    await act(async () => {
      await result.current.saveConfig(FAKE_CONFIG);
    });

    expect(fb.doc).toHaveBeenCalledWith(fb.services.db, "settings", "global");
    expect(fb.setDoc).toHaveBeenCalledWith(
      { path: "settings/global" },
      expect.objectContaining({ ...FAKE_CONFIG, updatedAt: "SERVER_TIMESTAMP", updatedBy: "staff@orns.org" })
    );
    expect(result.current.config).toEqual(FAKE_CONFIG);
    expect(toast.success).toHaveBeenCalledWith("Settings saved and synced across devices!");
  });

  it("shows an error toast and rethrows when the write fails", async () => {
    const fb = makeFirebaseMock();
    mockedGetFirebase.mockResolvedValue(fb.services as any);
    fb.setDoc.mockRejectedValue(new Error("quota exceeded"));

    const { result } = renderConfigHook();
    await waitFor(() => expect(fb.services.onAuthStateChanged).toHaveBeenCalled());
    act(() => fb.fireAuthChange({ email: "staff@orns.org" }));
    await waitFor(() => expect(result.current.firebaseUser).toEqual({ email: "staff@orns.org" }));

    await expect(result.current.saveConfig(FAKE_CONFIG)).rejects.toThrow("quota exceeded");
    expect(toast.error).toHaveBeenCalledWith("Error saving settings: quota exceeded");
  });
});
