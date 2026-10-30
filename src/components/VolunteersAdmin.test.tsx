// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VolunteersAdmin from "./VolunteersAdmin";
import { fetchWithRetry } from "@/services/google-api";
import { postJsonOnce } from "@/services/apiClient";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
  errorTextFrom: (d: any, f: string) => d?.error || f,
}));
vi.mock("@/services/apiClient", () => ({ postJsonOnce: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => ({ auctionState: "prep" }) }));

const VOLUNTEERS = [
  { id: "v1", email: "pat@gmail.com", name: "Pat Lee", status: "invited", invitedBy: "dan@orns.org", invitedAt: "2026-03-01T00:00:00Z" },
  { id: "v2", email: "kim@yahoo.com", name: "Kim Ortiz", status: "active", invitedBy: "dan@orns.org", invitedAt: "2026-03-01T00:00:00Z", redeemedAt: "2026-03-14T23:02:00Z", lastSeenAt: new Date().toISOString() },
  { id: "v3", email: "lou@gmail.com", name: "Lou Park", status: "deactivated", deactivatedReason: "auction_closed", invitedBy: "dan@orns.org", invitedAt: "2026-03-01T00:00:00Z" },
];
// A table row's accessible name is its cells' text, so this finds a person's row as a screen reader would.
const rowName = (email: string) => ({ name: new RegExp(`\\b${email.replace(/[.]/g, "\\.")}`) });
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe("VolunteersAdmin", () => {
  beforeEach(() => {
    vi.mocked(fetchWithRetry).mockReset().mockResolvedValue(json({ volunteers: VOLUNTEERS, account: { connected: true, email: "auction-volunteers@orns.org", connectedBy: "dan@orns.org", connectedAt: "2026-03-02T00:00:00Z" } }));
    vi.mocked(postJsonOnce).mockReset().mockResolvedValue({});
  });

  it("shows whether the shared volunteer account is connected", async () => {
    render(<VolunteersAdmin />);
    expect(await screen.findByText("Connected: auction-volunteers@orns.org")).toBeInTheDocument();

    vi.mocked(fetchWithRetry).mockResolvedValue(json({ volunteers: [], account: { connected: false, email: "auction-volunteers@orns.org" } }));
    render(<VolunteersAdmin />);
    expect(await screen.findByText(/^Not connected - volunteer links won't work/)).toBeInTheDocument();
  });

  it("lists volunteers with their status; only invited or active ones can be revoked", async () => {
    render(<VolunteersAdmin />);
    const kim = await screen.findByRole("row", rowName("kim@yahoo.com"));
    expect(within(kim).getByText("Active")).toBeInTheDocument();
    expect(within(kim).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    const lou = screen.getByRole("row", rowName("lou@gmail.com"));
    expect(within(lou).getByText("Ended")).toBeInTheDocument();
    expect(within(lou).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("invites by name and email, and won't invite an @orns.org address", async () => {
    render(<VolunteersAdmin />);
    await screen.findByRole("row", rowName("pat@gmail.com"));
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

    await waitFor(() => expect(postJsonOnce).toHaveBeenCalledWith("/api/volunteers", { name: "Sam Staff", email: "sam@example.com" }, expect.any(String)));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks before revoking", async () => {
    render(<VolunteersAdmin />);
    await userEvent.click(within(await screen.findByRole("row", rowName("kim@yahoo.com"))).getByRole("button", { name: "Revoke" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(postJsonOnce).toHaveBeenCalledWith("/api/volunteers/v2/revoke", {}, expect.any(String)));
  });
});
