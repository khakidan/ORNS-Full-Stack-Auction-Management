// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersAdmin from "./UsersAdmin";
import { fetchWithRetry } from "@/services/google-api";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
  errorTextFrom: (d: any, f: string) => d?.error || f,
}));
vi.mock("./VolunteersAdmin", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let mockMyRole = "full_admin";
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "me@orns.org", role: mockMyRole } }),
}));

const USERS = [
  { email: "boss@orns.org", role: "full_admin", bootstrap: true },
  { email: "me@orns.org", role: "full_admin", bootstrap: false },
  { email: "jane@orns.org", role: "admin", bootstrap: false, lastLoginAt: "2026-10-01T15:00:00Z" },
  { email: "sam@orns.org", role: "user", bootstrap: false },
];

// A table row's accessible name is its cells' text, so this finds a person's row as a screen reader would.
const rowName = (email: string) => ({ name: new RegExp(`\\b${email.replace(/[.]/g, "\\.")}`) });
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response;

describe("UsersAdmin", () => {
  beforeEach(() => {
    vi.mocked(fetchWithRetry).mockReset();
    vi.mocked(fetchWithRetry).mockImplementation(async (url, init) =>
      (init as RequestInit | undefined)?.method === "PUT" ? json({ success: true }) : json({ users: USERS })
    );
  });

  it("lists staff with their role, locking the server-set Full Admin and your own row", async () => {
    render(<UsersAdmin />);

    const jane = await screen.findByRole("row", rowName("jane@orns.org"));
    expect(within(jane).getByRole("combobox", { name: "Role" })).toHaveTextContent(/^Administrator/);
    expect(within(screen.getByRole("row", rowName("boss@orns.org"))).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(screen.getByRole("row", rowName("boss@orns.org"))).getByText("Full Administrator")).toBeInTheDocument();
    expect(within(screen.getByRole("row", rowName("me@orns.org"))).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(screen.getByRole("row", rowName("sam@orns.org"))).getByText("Never")).toBeInTheDocument();
  });

  it("lets an Administrator give only Administrator or User, and locks a Full Administrator's row", async () => {
    mockMyRole = "admin";
    vi.mocked(fetchWithRetry).mockImplementation(async () =>
      json({ users: [...USERS, { email: "alex@orns.org", role: "full_admin", bootstrap: false }] }));
    try {
      const user = userEvent.setup();
      render(<UsersAdmin />);
      const sam = await screen.findByRole("row", rowName("sam@orns.org"));
      const offered = async (select: HTMLElement) => {
        await user.click(select);
        const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
        return names;
      };

      expect(await offered(within(sam).getByRole("combobox", { name: "Role" }))).toEqual(["Administrator", "User"]);
      expect(await offered(screen.getAllByRole("combobox", { name: "Role" })[0])).toEqual(["Administrator", "User"]);
      const alex = screen.getByRole("row", rowName("alex@orns.org"));
      expect(within(alex).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(alex).getByTitle("Only a Full Administrator can change a Full Administrator's role")).toBeInTheDocument();
    } finally {
      mockMyRole = "full_admin";
    }
  });

  it("changes a role from the row's dropdown", async () => {
    const user = userEvent.setup();
    render(<UsersAdmin />);
    const sam = await screen.findByRole("row", rowName("sam@orns.org"));

    await user.click(within(sam).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Administrator" }));

    await waitFor(() =>
      expect(fetchWithRetry).toHaveBeenCalledWith("/api/users/sam%40orns.org/role", expect.objectContaining({ method: "PUT", body: JSON.stringify({ role: "admin" }) }))
    );
  });

  it("gives a role to an address that hasn't signed in yet, only for @orns.org addresses", async () => {
    render(<UsersAdmin />);
    await screen.findByRole("row", rowName("sam@orns.org"));
    const input = screen.getByLabelText("Give a role to");
    const save = screen.getByRole("button", { name: "Save Role" });

    await userEvent.type(input, "pat@gmail.com");
    expect(save).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, "New.Person@orns.org");
    await userEvent.click(save);

    await waitFor(() =>
      expect(fetchWithRetry).toHaveBeenCalledWith("/api/users/new.person%40orns.org/role", expect.objectContaining({ body: JSON.stringify({ role: "admin" }) }))
    );
    await waitFor(() => expect(input).toHaveValue(""));
  });
});
