import { getAdminFirestore } from "./firebaseAdmin";
import { Role, isRole } from "../utils/permissions";

/**
 * Staff roles. An @orns.org address is a User unless it is listed in the
 * FULL_ADMIN_EMAILS environment variable (always Full Administrator, so
 * nobody can lock every admin out from the app) or has a role assigned in
 * Firestore `users/{email}` from the Users tab.
 *
 * Roles are read on every request (requireAuth.ts), cached for
 * CACHE_TTL_MS so a busy auction night isn't a Firestore read per
 * request; a role change takes effect within that time. If Firestore
 * can't be read and nothing is cached, the person is treated as a User -
 * never given more access than they might have.
 */
const COLLECTION = "users";
const CACHE_TTL_MS = 30 * 1000;

export interface StaffUser {
  email: string;
  role: Role;
  /** True for FULL_ADMIN_EMAILS addresses - their role can't be changed in the app. */
  bootstrap: boolean;
  assignedBy?: string;
  assignedAt?: string;
  lastLoginAt?: string;
}

const cache = new Map<string, { role: Role; readAt: number }>();

/** A failing Firestore fails every request; log that at most once a minute, not once per request. */
const WARN_INTERVAL_MS = 60 * 1000;
let lastWarnAt = -Infinity;
let suppressedWarnings = 0;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function bootstrapAdmins(): string[] {
  return (process.env.FULL_ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdmins().includes(normalizeEmail(email));
}

export async function getRole(email: string, now = Date.now()): Promise<Role> {
  const key = normalizeEmail(email);
  if (isBootstrapAdmin(key)) return "full_admin";

  const hit = cache.get(key);
  if (hit && now - hit.readAt < CACHE_TTL_MS) return hit.role;

  try {
    const snap = await getAdminFirestore().collection(COLLECTION).doc(key).get();
    const stored = snap.data()?.role;
    const role: Role = isRole(stored) ? stored : "user";
    cache.set(key, { role, readAt: now });
    return role;
  } catch (err: any) {
    if (now - lastWarnAt >= WARN_INTERVAL_MS) {
      const skipped = suppressedWarnings ? ` (${suppressedWarnings} more like this in the last minute)` : "";
      console.warn(`[Users] Couldn't read the role for ${key}; ${hit ? "using the last value read" : "treating them as a User"}${skipped}:`, err?.message || err);
      lastWarnAt = now;
      suppressedWarnings = 0;
    } else {
      suppressedWarnings++;
    }
    return hit ? hit.role : "user";
  }
}

/** Records a sign-in, so the Users tab can list everyone who has used the app. Best-effort. */
export async function recordLogin(email: string): Promise<void> {
  const key = normalizeEmail(email);
  await getAdminFirestore().collection(COLLECTION).doc(key).set(
    { email: key, lastLoginAt: new Date().toISOString() },
    { merge: true }
  );
}

/** Assigns an admin role, or (role "user") removes it. */
export async function setRole(email: string, role: Role, assignedBy: string): Promise<void> {
  const key = normalizeEmail(email);
  await getAdminFirestore().collection(COLLECTION).doc(key).set(
    { email: key, role, assignedBy: normalizeEmail(assignedBy), assignedAt: new Date().toISOString() },
    { merge: true }
  );
  cache.delete(key);
}

/** Everyone who has signed in or has a role, plus the FULL_ADMIN_EMAILS addresses. */
export async function listUsers(): Promise<StaffUser[]> {
  const snap = await getAdminFirestore().collection(COLLECTION).get();
  const byEmail = new Map<string, StaffUser>();
  for (const doc of snap.docs) {
    const d = doc.data();
    const email = normalizeEmail(d.email || doc.id);
    byEmail.set(email, {
      email,
      role: isRole(d.role) ? d.role : "user",
      bootstrap: false,
      assignedBy: d.assignedBy,
      assignedAt: d.assignedAt,
      lastLoginAt: d.lastLoginAt,
    });
  }
  for (const email of bootstrapAdmins()) {
    byEmail.set(email, { ...(byEmail.get(email) || { email }), email, role: "full_admin", bootstrap: true });
  }
  const order: Record<Role, number> = { full_admin: 0, admin: 1, user: 2 };
  return [...byEmail.values()].sort((a, b) => order[a.role] - order[b.role] || a.email.localeCompare(b.email));
}

/** Test-only: forget cached roles. */
export function _resetUserCacheForTesting(): void {
  cache.clear();
  lastWarnAt = -Infinity;
  suppressedWarnings = 0;
}
