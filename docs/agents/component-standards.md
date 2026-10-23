# Component Standards

> **Status: written for this codebase's actual current state**, verified
> directly against `src/components/` on 2026-09-02 (not carried over from
> another project). This document is a supplement to
> [`style_guide.md`](./style_guide.md) and
> [`file-reference.md`](./file-reference.md), which remain authoritative
> for this app's exact visual tokens and directory layout - see
> `AGENTS.md`'s Documentation Registry. Where anything below conflicts
> with those two, they win.

The goals are the same as any UI standards doc: consistent user
experience, predictable behavior, accessibility by default, minimal
visual complexity, reusable patterns, maintainable React code.

---

## What this app actually has

This app's component library is **shadcn generated in the `base-nova`
style, on `@base-ui/react` primitives** (`components.json`) - not Radix
directly, and not a from-scratch component set. `src/components/ui/`
currently contains: `alert-dialog.tsx`, `badge.tsx`, `button.tsx`,
`card.tsx`, `checkbox.tsx`, `ConfirmationDialog.tsx`, `dialog.tsx`,
`IconButton.tsx` (app-specific), `input.tsx`, `label.tsx`,
`ListPageCard.tsx` (app-specific), `LoadingButton.tsx` (app-specific),
`scroll-area.tsx`, `select.tsx`,
`sonner.tsx` (toasts), `StatusStatePlaceholder.tsx` (app-specific),
`table.tsx`, `tabs.tsx`, `textarea.tsx`. Check this list (or
`file-reference.md`)
before assuming a pattern isn't componentized yet. (`EditableCell.tsx`
was deleted once its last two consumers - `AttendeeRow.tsx`, then
`AuctionItemRow.tsx` - both moved to a single-dialog edit pattern
instead of per-field inline editing; see `CHANGELOG.md`.)

`IconButton`, `LoadingButton`, and `ConfirmationDialog` were the three
gaps this doc used to flag as missing (see "Icon-Only Buttons" and
"Dialogs and Modals" below) - all three now exist and are in real use
app-wide (confirmed 2026-09-04: `IconButton` in `AttendeeRow.tsx`,
`FolderFilesCard.tsx`, `AuctionItemRow.tsx`; `LoadingButton` in 13
files including `Checkout.tsx`, `BidEntry.tsx`, `ConfigSettings.tsx`;
`ConfirmationDialog` in `TicketAttendeeTab.tsx`, `Checkout.tsx`,
`AuctionItemsTab.tsx`, `PendingPaymentDialog.tsx`). There is still no
generic card-primitives subdirectory - `Card`/`CardHeader`/`CardContent`/
`CardFooter` from `card.tsx` are used directly wherever a page's Card
layout is genuinely one-off, which remains correct practice, not a gap.
Where four pages independently hand-rolled the *same* Card skeleton
(the search-and-list pages below), that duplication was real and is now
consolidated: `ListPageCard.tsx` wraps `Card`/`CardHeader`/`CardContent`
with the shared bare-header, `p-0`-content shape those four pages all
need, closing off the exact per-page `className` override drift that
caused the whitespace double-gap bugs (see `CHANGELOG.md`).

Two small shared pieces sit beside the views in `src/components/`:

- **`FormField.tsx`** - one labelled field in the add/edit dialogs (inside
  a `FormSection`). It renders the small muted label and passes a
  generated `id` to its child, so the label is linked to the control:
  `<FormField label="Donor">{(id) => <Input id={id} ... />}</FormField>`.
  For a `Select`, put the `id` on its `SelectTrigger`. Every dialog
  field needs a linked label (or an `aria-label` when there's no visible
  one, as in `AttendeeGuestsEditor.tsx`).
- **`RowIdTile.tsx`** - the number box at the start of `BidderRow`,
  `ItemRow` and `AuctionItemRow`; pair it with `font-semibold
  text-row-title` for the row's name.

There are seven top-level workflow views under `src/components/`
(`Dashboard.tsx`, `Bidders.tsx`, `Items.tsx`, `BidEntry.tsx`,
`Checkout.tsx`, `Receipts.tsx`, plus tab/workflow files like
`AuctionItemsTab.tsx`, `TicketAttendeeTab.tsx`, `ConfigSettings.tsx`,
`BundlingDialog.tsx`) - these are the real analogues of "page-level"
components in this codebase, not a generic `PlayerCard`/`EncounterView`
pattern from another domain.

---

## General Component Rules

### One Responsibility

Every component should have one clear purpose. This used to be a real,
outstanding gap - `AuctionItemsTab.tsx` (969 lines), `Bidders.tsx` and
`Checkout.tsx` (644 lines each), `ConfigSettings.tsx` (572 lines),
`Dashboard.tsx` (517 lines) - but all six were split via the
container-hook pattern (a thin `src/components/*.tsx` view composing a
`src/hooks/use*State.ts` hook) as of 2026-09-04: `AuctionItemsTab.tsx`
181, `Bidders.tsx` 107, `Checkout.tsx` 143, `ConfigSettings.tsx` 64,
`Dashboard.tsx` 57. No file under `src/components/` (excluding `ui/`)
exceeds 250 lines today - the largest is `BundlingDialog.tsx` at 182.
Keep new components in the 50-250 line range from the start rather than
letting this drift back.

New components should stay well under these sizes. If a component
handles unrelated concerns (e.g. rendering a table *and* owning the
search/filter state *and* the row-action dialogs), split it into a
container + presentational pieces before it grows further.

---

## Component API Standards

### Prefer Explicit Props

```tsx
<Button variant="destructive" onClick={handleDelete}>Delete Item</Button>
```

over configuration-object props. This app's real `Button`
(`src/components/ui/button.tsx`) already does this: `variant` is
`default | outline | secondary | ghost | destructive | link`, and `size`
is `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`. Note
this is **not** the `intent` prop name used in some other design-system
docs - in this codebase the prop is `variant`. Use `destructive` for
Delete/Remove actions, `default` for the primary action in a section,
`outline`/`ghost` for secondary actions, `link` for text-link-style
actions.

### Boolean Props

Avoid stacking booleans on a component when a variant/size prop already
covers the combination. `Card` here uses `size="default" | "sm"` rather
than a `compact` boolean, which is the pattern to follow for new
components too.

### Composition

Prefer composition, as `Card` already models:

```tsx
<Card>
  <CardHeader><CardTitle>...</CardTitle></CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>
```

---

## Buttons

Buttons represent actions, never navigation - this app has no client-side
router; `App.tsx` manages workflow switching via `WorkflowType` state and
`history.pushState`, not `<Link>`-style navigation, so there's little
risk of buttons standing in for links here, but keep the distinction
clear when adding any new anchor-like controls.

### Button Rules

Buttons must: have clear labels, show disabled state (`disabled:opacity-50`
is already built into `buttonVariants`), prevent duplicate submissions,
support keyboard activation, have visible focus states
(`focus-visible:ring-3 focus-visible:ring-ring/50` is already built in).

`src/components/ui/LoadingButton.tsx` is the shared busy/spinner-state
wrapper - use it instead of hand-rolling an inline `Loader2` +
`animate-spin` per call site (13 real call sites today, including
`BidEntry.tsx`, `Checkout.tsx`, `ConfigSettings.tsx`).

### Icon-Only Buttons

`src/components/ui/IconButton.tsx` wraps `Button` with `size` locked to
the icon variants and `aria-label` **required at the type level** - an
icon-only button can't ship without an accessible label the way a plain
`<Button size="icon">` could. Use it for any new icon-only control
(real call sites today: `AttendeeRow.tsx`, `FolderFilesCard.tsx`,
`AuctionItemRow.tsx`).

---

## Forms

### Labels

Every input must have a visible `<Label>` (`src/components/ui/label.tsx`).
Avoid `<Input placeholder="..." />` as a stand-in for a label.

### Selects and Dropdowns

This app's `Select` (`src/components/ui/select.tsx`) is built on
`@base-ui/react/select`, not Radix. Every dropdown in real component code
already goes through it - a repo-wide check found native `<select>` only
inside test-mock files (`*.test.tsx`), never in actual `src/components/*.tsx`
UI code. Keep it that way for any new dropdown, name-only choices
included.

`SelectValue` renders the raw item value unless given explicit `children`
- watch for this whenever the display text differs from the stored value
(an ID displayed as a name, a status enum displayed as a friendly label).

### Checkboxes

Use `Checkbox` (`src/components/ui/checkbox.tsx`) for multi-select and
independent toggle state, not for actions.

---

## Tables

`src/components/ui/table.tsx` is the shared primitive, and
`src/components/DataTableWrapper.tsx` (85 lines) is the shared
scroll-container/empty-state wrapper around it - use it for any new
data table rather than hand-rolling that scaffolding again. Real call
sites today: `Items.tsx`, `BiddersTable.tsx`, `WinnerGrid.tsx`,
`Receipts.tsx`, `AttendeesTable.tsx`.

### Empty Tables

This app already follows the "explain why it's empty" rule in practice:
e.g. `"No winners found in this category."` (`Checkout.tsx`), `"No
bidders found matching \"{searchTerm}\""` (`Bidders.tsx`), `"No items
found."` (`AuctionItemsTab.tsx`), `"No receipts found in this
folder."` (`Receipts.tsx`). Match this tone for any new empty state -
name what's empty, and where it's scoped to a search term, echo the term
back.

---

## Dialogs and Modals

This app's dialog primitives are `dialog.tsx`, `alert-dialog.tsx`,
and `src/components/ui/ConfirmationDialog.tsx` - the shared destructive-
confirmation wrapper (built on `alert-dialog.tsx`). Use it for any new
destructive-confirmation flow rather than hand-rolling one from
`alert-dialog.tsx` again. Real call sites today: `TicketAttendeeTab.tsx`,
`Checkout.tsx`, `AuctionItemsTab.tsx`, `PendingPaymentDialog.tsx`.

Dialogs must: trap focus, close with Escape, have a clear title, have
clear actions, return focus after closing - `@base-ui/react`'s dialog
primitives handle the mechanics; don't hand-roll focus trapping.

### Winner-notification toasts (app-specific rule)

This is a real, load-bearing business rule from `patterns.md`, restated
here because it's a component-usage rule: when a bidder who has **already
checked out** wins an item, the toast must use `duration: Infinity` and an
explicit `action` labeled "I have confirmed", and must name the item won.
Don't treat this as a generic toast - it needs the persistent variant.

---

## Toasts

Toasts (`src/components/ui/sonner.tsx`, via `sonner`) are used for
successful saves and background sync failures. `sonner.tsx` sets
`theme="light"`: the app runs a single light theme with no in-app theme
switcher (`style_guide.md`), so toasts stay light even on a computer set
to dark mode. (It used to read `next-themes`' `useTheme` with no
ThemeProvider, which followed the OS setting instead.)

Never use a toast for the winner-notification case above without the
`duration: Infinity` override - a normal auto-dismissing toast would let a
staff member miss a check-out conflict during a live event.

---

## Accessibility Requirements

Every component must consider: keyboard navigation, focus visibility
(`focus-visible:ring-*` classes are already the established pattern
across `ui/`), semantic HTML, screen reader support. Never remove focus
outlines without replacement.

---

## Component Checklist

Before creating a component:

- Does `src/components/ui/` already have this? (check the real list
  above, or `file-reference.md`)
- Is the API explicit (`variant`/`size` props), not a config object?
- Is accessibility considered (labels, `aria-label` on icon-only buttons)?
- Does it handle loading, empty, and error states the way the rest of
  this app already does (see the Empty Tables examples above)?
- Does it follow this app's existing visual patterns
  (`style_guide.md`/`tailwind-style-guide.md`)?

---

## AI Generation Rules

Prefer existing `src/components/ui/` primitives over new ones,
composition over configuration, semantic HTML, accessible controls. Avoid
inventing a second button/card/select/dialog/table pattern when this
app's real ones (`IconButton`, `LoadingButton`, `ConfirmationDialog`,
`DataTableWrapper` all now exist, alongside `Button`/`Card`/`Select`)
already cover the case. When a genuinely new gap turns up, check
`ROADMAP.md`'s audit backlog first before building a wrapper - it may
already be logged.
