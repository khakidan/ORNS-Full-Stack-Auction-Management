// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VolunteersAdmin from "./VolunteersAdmin";
import { fetchWithRetry } from "@/services/google-api";
import { postJson } from "@/services/apiClient";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
  errorTextFrom: (d: any, f: string) => d?.error || f,
}));
vi.mock("@/services/apiClient", () => ({ postJson: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => ({ auctionState: "prep" }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

const VOLUNTEERS = [
  { id: "v1", email: "pat@gmail.com", name: "Pat Lee", status: "invited", invitedBy: "dan@orns.org", invitedAt: "2026-03-01T00:00:00Z" },
  { id: "v2", email: "kim@yahoo.com", name: "Kim Ortiz", status: "active", invitedBy: "dan@orns.org", invitedAt: "2026-03-01T00:00:00Z", redeemedAt: "2026-03-14T23:02:00Z", lastSeenAt: new Date().toISOString() },
  { id: "v3", email: "lou@gmail.com", name: "Lou Park", status: "deactivated", deactivatedReason: "auction_closed", invitedBy: "dan@orns.org", invitedAt: "2026-03-01T00:00:00Z" },
];
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe("VolunteersAdmin", () => {
  beforeEach(() => {
    vi.mocked(fetchWithRetry).mockReset().mockResolvedValue(json({ volunteers: VOLUNTEERS, account: { connected: true, email: "auction-volunteers@orns.org", connectedBy: "dan@orns.org", connectedAt: "2026-03-02T00:00:00Z" } }));
    vi.mocked(postJson).mockReset().mockResolvedValue({});
  });

  it("shows whether the shared volunteer account is connected", async () => {
    render(<VolunteersAdmin />);
    expect(await screen.findByTestId("volunteer-account-status")).toHaveTextContent("Connected: auction-volunteers@orns.org");

    vi.mocked(fetchWithRetry).mockResolvedValue(json({ volunteers: [], account: { connected: false, email: "auction-volunteers@orns.org" } }));
    render(<VolunteersAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("volunteer-account-status")[1]).toHaveTextContent("Not connected"));
  });

  it("lists volunteers with their status; only invited or active ones can be revoked", async () => {
    render(<VolunteersAdmin />);
    const kim = await screen.findByTestId("volunteer-row-kim@yahoo.com");
    expect(within(kim).getByText("Active")).toBeInTheDocument();
    expect(within(kim).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    const lou = screen.getByTestId("volunteer-row-lou@gmail.com");
    expect(within(lou).getByText("Ended")).toBeInTheDocument();
    expect(within(lou).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("invites by name and email, and won't invite an @orns.org address", async () => {
    render(<VolunteersAdmin />);
    await screen.findByTestId("volunteer-row-pat@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: /Invite Volunteer/ }));
    const dialog = screen.getByRole("dialog");
    const send = within(dialog).getByRole("button", { name: /Send Invitation/ });

    await userEvent.type(within(dialog).getByLabelText("Name"), "Sam Staff");
    await userEvent.type(within(dialog).getByLabelText("Email"), "sam@orns.org");
    expect(send).toBeDisabled();
    expect(within(dialog).getByText(/give them a role/)).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText("Email"));
    await userEvent.type(within(dialog).getByLabelText("Email"), "sam@example.com");
    await userEvent.click(send);

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/volunteers", { name: "Sam Staff", email: "sam@example.com" }, expect.any(String)));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks before revoking", async () => {
    render(<VolunteersAdmin />);
    await userEvent.click(within(await screen.findByTestId("volunteer-row-kim@yahoo.com")).getByRole("button", { name: "Revoke" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/volunteers/v2/revoke", {}, expect.any(String)));
  });
});
