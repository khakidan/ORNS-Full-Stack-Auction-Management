/**
 * Mirror of server/utils/permissions.ts - keep the two in step. The
 * server enforces these; the client only hides what the server would
 * refuse anyway.
 */
/** A staff role - what Settings > Users assigns. */
export type Role = "full_admin" | "admin" | "user";
/** Whoever is signed in: a staff role, or a volunteer. */
export type UserRole = Role | "volunteer";

export type Capability = "settings" | "settings.system" | "users.manage" | "auction.stage" | "tickets.edit" | "attendees.delete" | "bidders.walkIn";

export const ROLE_LABELS: Record<UserRole, string> = {
  full_admin: "Full Administrator",
  admin: "Administrator",
  user: "User",
  volunteer: "Volunteer",
};

/** The signed-in person, as /auth/status reports them. */
export interface AuthUser {
  email: string;
  role: UserRole;
  roleLabel: string;
  capabilities: Capability[];
}
