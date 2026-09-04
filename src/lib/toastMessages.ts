/**
 * Shared error-toast text for hooks that apply an optimistic update and
 * roll it back on a failed background sync. Previously drifted into two
 * near-identical variants ("...retrying... local state reverted." and
 * "...rolling back...") - both implied an automatic retry that doesn't
 * actually happen anywhere in this app (the user has to manually retry
 * the action themselves), so the wording here is corrected, not just
 * merged. `useBundling.ts`'s `executeBundle` deliberately does NOT use
 * this constant - it has no optimistic update to roll back at all, so it
 * gets its own accurate message instead.
 */
export const ROLLBACK_SYNC_ERROR_MESSAGE = "Failed to sync updates. Your local change has been reverted.";
