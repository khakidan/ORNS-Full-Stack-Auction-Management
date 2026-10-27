/**
 * Who can do what. The server enforces these (requirePermission.ts); the
 * client mirrors them in src/lib/permissions.ts only to hide what the
 * server would refuse anyway - keep the two in step.
 *
 * - Full Administrator: everything.
 * - Administrator: everything except the Settings page.
 * - User: everything except Settings; can't Go Live, Close the auction,
 *   Set Up the Bid Management App, or delete attendees.
 */
export type Role = "full_admin" | "admin" | "user";

export type Capability =
  /** The Settings page and every route behind it (setup, archive, PayPal sweeper, Apps Script, bug-report admin). */
  | "settings"
  /** The Users tab: assigning roles. */
  | "users.manage"
  /** Go Live, Close Auction, Set Up Bid Management App. */
  | "auction.stage"
  /** Deleting an attendee from the Attendee List. */
  | "attendees.delete";

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  full_admin: ["settings", "users.manage", "auction.stage", "attendees.delete"],
  admin: ["auction.stage", "attendees.delete"],
  user: [],
};

export const ROLE_LABELS: Record<Role, string> = {
  full_admin: "Full Administrator",
  admin: "Administrator",
  user: "User",
};

export function capabilitiesFor(role: Role): Capability[] {
  return [...CAPABILITIES[role]];
}

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

export function isRole(value: unknown): value is Role {
  return value === "full_admin" || value === "admin" || value === "user";
}
