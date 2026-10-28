/**
 * Who can do what. The server enforces these (requirePermission.ts); the
 * client mirrors them in src/lib/permissions.ts only to hide what the
 * server would refuse anyway - keep the two in step.
 *
 * - Full Administrator: everything.
 * - Administrator: everything except the Settings page's PayPal
 *   Integration, Google Apps Scripts and Bug Reports tabs. A tab an
 *   Administrator can see, they can use in full - except that on Users
 *   they grant only their own level or lower (roleChangeRefusal).
 * - User: no Settings page; the Auction Tickets page is view-only; can't
 *   Go Live, Close the auction, or Set Up the Bid Management App.
 * - Volunteer (not an @orns.org address; only while the auction is Live):
 *   none of these capabilities, and only the Bid Management routes listed
 *   in server/middleware/volunteerAccess.ts.
 */
/** A staff role - what Settings > Users assigns. */
export type Role = "full_admin" | "admin" | "user";
/** Whoever is signed in: a staff role, or a volunteer. */
export type UserRole = Role | "volunteer";

export type Capability =
  /** The Settings page's Configuration and Action History tabs, and the routes behind them (config, setup, archive, action history). */
  | "settings"
  /** The Settings page's PayPal Integration, Google Apps Scripts and Bug Reports tabs (PayPal sandbox/live, the sweeper, Apps Script versions, bug-report admin). */
  | "settings.system"
  /** The Users tab: assigning roles. */
  | "users.manage"
  /** Go Live, Close Auction, Set Up Bid Management App. */
  | "auction.stage"
  /** Changing the Auction Tickets page: adding and editing attendees, payment status, bidder labels. */
  | "tickets.edit"
  /** Deleting an attendee from the Attendee List. */
  | "attendees.delete"
  /** Registering a walk-in bidder (staff only - not in the volunteers' list). */
  | "bidders.walkIn";

const CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  full_admin: ["settings", "settings.system", "users.manage", "auction.stage", "tickets.edit", "attendees.delete", "bidders.walkIn"],
  admin: ["settings", "users.manage", "auction.stage", "tickets.edit", "attendees.delete", "bidders.walkIn"],
  user: ["bidders.walkIn"],
  volunteer: [],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  full_admin: "Full Administrator",
  admin: "Administrator",
  user: "User",
  volunteer: "Volunteer",
};

export function capabilitiesFor(role: UserRole): Capability[] {
  return [...CAPABILITIES[role]];
}

export function can(role: UserRole, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

export function isRole(value: unknown): value is Role {
  return value === "full_admin" || value === "admin" || value === "user";
}
