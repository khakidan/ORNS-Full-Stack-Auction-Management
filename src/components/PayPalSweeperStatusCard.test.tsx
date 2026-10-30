/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PayPalSweeperStatusCard from "./PayPalSweeperStatusCard";

vi.mock("@/services/google-api", () => ({
  getPaypalSweeperStatus: vi.fn(),
  runPaypalSweepNow: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getPaypalSweeperStatus, runPaypalSweepNow } from "@/services/google-api";

const mockedGetStatus = vi.mocked(getPaypalSweeperStatus);
const mockedRunNow = vi.mocked(runPaypalSweepNow);

describe("PayPalSweeperStatusCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a healthy state once the credential is configured and a run has completed", async () => {
    mockedGetStatus.mockResolvedValue({
      credentialConfigured: true,
      credentialUpdatedBy: "staff@orns.org",
      credentialUpdatedAt: "2026-01-01T00:00:00.000Z",
      intervalMinutes: 5,
      scheduleActive: true,
      lastScheduledRunAt: "2026-01-01T00:05:00.000Z",
      lastRunAt: "2026-01-01T00:05:00.000Z",
      lastResult: { pending: 1, resolved: 1, escalated: 0 },
    });

    render(<PayPalSweeperStatusCard />);

    await waitFor(() => expect(screen.getByText("Running")).toBeInTheDocument());
    expect(screen.getByText(/Signed in by staff@orns.org/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending, 1 resolved, 0 escalated/)).toBeInTheDocument();
  });

  it("flags the credential as not configured when no admin has signed in yet", async () => {
    mockedGetStatus.mockResolvedValue({
      credentialConfigured: false,
      credentialUpdatedBy: null,
      credentialUpdatedAt: null,
      intervalMinutes: 5,
      scheduleActive: false,
      lastScheduledRunAt: null,
      lastRunAt: null,
      lastResult: null,
    });

    render(<PayPalSweeperStatusCard />);

    await waitFor(() => expect(screen.getByText("Needs Attention")).toBeInTheDocument());
    expect(screen.getByText(/Not configured yet - sign in once to enable/)).toBeInTheDocument();
    expect(screen.getByText(/No runs recorded yet/)).toBeInTheDocument();
  });

  it("shows Paused (not Needs Attention) when the credential is fine but the Cloud Scheduler job isn't running - normal off-season", async () => {
    mockedGetStatus.mockResolvedValue({
      credentialConfigured: true,
      credentialUpdatedBy: "staff@orns.org",
      credentialUpdatedAt: "2026-01-01T00:00:00.000Z",
      intervalMinutes: 5,
      scheduleActive: false,
      lastScheduledRunAt: "2025-10-01T00:00:00.000Z",
      lastRunAt: "2025-10-01T00:00:00.000Z",
      lastResult: { pending: 0, resolved: 0, escalated: 0 },
    });

    render(<PayPalSweeperStatusCard />);

    await waitFor(() => expect(screen.getByText("Paused")).toBeInTheDocument());
    expect(screen.getByText("Paused or not set up")).toBeInTheDocument();
  });

  it("shows an unreachable-server state without crashing when the status fetch fails", async () => {
    mockedGetStatus.mockRejectedValue(new Error("network down"));

    render(<PayPalSweeperStatusCard />);

    await waitFor(() => expect(screen.getByText(/Couldn't reach the server/)).toBeInTheDocument());
  });

  it("lets the user trigger an immediate sweep via the Run Sweep Now button", async () => {
    const user = userEvent.setup();
    mockedGetStatus.mockResolvedValue({
      credentialConfigured: true,
      credentialUpdatedBy: "staff@orns.org",
      credentialUpdatedAt: "2026-01-01T00:00:00.000Z",
      intervalMinutes: 5,
      scheduleActive: true,
      lastScheduledRunAt: "2026-01-01T00:05:00.000Z",
      lastRunAt: "2026-01-01T00:05:00.000Z",
      lastResult: { pending: 1, resolved: 1, escalated: 0 },
    });
    mockedRunNow.mockResolvedValue({ pending: 0, resolved: 0, escalated: 0 });

    render(<PayPalSweeperStatusCard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Sweep Now" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Run Sweep Now" }));

    await waitFor(() => expect(mockedRunNow).toHaveBeenCalledTimes(1));
  });
});
