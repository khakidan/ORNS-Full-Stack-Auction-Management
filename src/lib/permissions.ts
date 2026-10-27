/**
 * Mirror of server/utils/permissions.ts - keep the two in step. The
 * server enforces these; the client only hides what the server would
 * refuse anyway.
 */
export type Role = "full_admin" | "admin" | "user";

export type Capability = "settings" | "users.manage" | "auction.stage" | "attendees.delete";

export const ROLE_LABELS: Record<Role, string> = {
  full_admin: "Full Administrator",
  admin: "Administrator",
  user: "User",
};

/** The signed-in person, as /auth/status reports them. */
export interface AuthUser {
  email: string;
  role: Role;
  roleLabel: string;
  capabilities: Capability[];
}
