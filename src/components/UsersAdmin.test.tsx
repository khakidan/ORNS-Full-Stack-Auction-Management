// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "me@orns.org", role: "full_admin" } }),
}));
// base-ui Select needs real layout; a native <select> is enough here.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select aria-label="Role" value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

const USERS = [
  { email: "boss@orns.org", role: "full_admin", bootstrap: true },
  { email: "me@orns.org", role: "full_admin", bootstrap: false },
  { email: "jane@orns.org", role: "admin", bootstrap: false, lastLoginAt: "2026-10-01T15:00:00Z" },
  { email: "sam@orns.org", role: "user", bootstrap: false },
];

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

    const jane = await screen.findByTestId("staff-row-jane@orns.org");
    expect(within(jane).getByRole("combobox", { name: "Role" })).toHaveValue("admin");
    expect(within(screen.getByTestId("staff-row-boss@orns.org")).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("staff-row-boss@orns.org")).getByText("Full Administrator")).toBeInTheDocument();
    expect(within(screen.getByTestId("staff-row-me@orns.org")).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("staff-row-sam@orns.org")).getByText("Never")).toBeInTheDocument();
  });

  it("changes a role from the row's dropdown", async () => {
    render(<UsersAdmin />);
    const sam = await screen.findByTestId("staff-row-sam@orns.org");

    fireEvent.change(within(sam).getByRole("combobox", { name: "Role" }), { target: { value: "admin" } });

    await waitFor(() =>
      expect(fetchWithRetry).toHaveBeenCalledWith("/api/users/sam%40orns.org/role", expect.objectContaining({ method: "PUT", body: JSON.stringify({ role: "admin" }) }))
    );
  });

  it("gives a role to an address that hasn't signed in yet, only for @orns.org addresses", async () => {
    render(<UsersAdmin />);
    await screen.findByTestId("staff-row-sam@orns.org");
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
