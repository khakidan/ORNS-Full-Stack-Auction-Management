import type { Role } from "./permissions";

/**
 * What an Action History row's "Undo Data" column holds (as JSON): exactly
 * what Undo needs to reverse that action. A row without it can't be undone.
 * The Items/Tickets Apps Scripts write the "cells" kind for single-cell
 * sheet edits too, so keep that shape stable.
 */
export type UndoSpec =
  /** Put `before` back into `range`, if it still holds `after`. */
  | { kind: "cells"; spreadsheetId: string; range: string; before: unknown[][]; after: unknown[][]; lock?: string }
  /** Put the listed item fields back through the normal item update (which renumbers IDs), if each row still holds `after`. */
  | { kind: "items"; spreadsheetId: string; rows: { rowIndex: number; name: string; before: Record<string, unknown>; after: Record<string, unknown> }[] }
  /** Delete an added item, if its row still holds that item. */
  | { kind: "item-add"; spreadsheetId: string; rowIndex: number; name: string }
  /** Restore a bundle's original items. */
  | { kind: "bundle"; spreadsheetId: string; bundleToken: string; bundleName: string }
  /** Put a staff role back, if it hasn't changed since. */
  | { kind: "role"; email: string; before: Role; after: Role };
