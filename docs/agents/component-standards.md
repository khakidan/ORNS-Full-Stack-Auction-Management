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
`card.tsx`, `checkbox.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`,
`scroll-area.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`,
`sonner.tsx` (toasts), `table.tsx`, `tabs.tsx`, `textarea.tsx`, and one
app-specific primitive, `EditableCell.tsx`. Check this list (or
`file-reference.md`) before assuming a pattern isn't componentized yet.

There is no dedicated `IconButton` component, no `ConfirmationDialog`
wrapper, and no card-primitives subdirectory - `Card`/`CardHeader`/
`CardContent`/`CardFooter` from `card.tsx` are used directly. Treat
absence of a wrapper as a real gap (see
[`refactor-opportunities.md`](./refactor-opportunities.md)), not as
evidence the pattern doesn't apply.

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

Every component should have one clear purpose. Several of this app's
existing top-level views have outgrown that already:
`AuctionItemsTab.tsx` (969 lines), `Bidders.tsx` and `Checkout.tsx` (644
lines each), `ConfigSettings.tsx` (572 lines), `Dashboard.tsx` (517
lines). These aren't hypothetical "avoid this" examples - they're real
files in this repo that mix search/filter UI, table rendering, dialogs,
and business logic in one component. Splitting them is tracked in
`refactor-opportunities.md` rather than treated as a rule to apply only
to new code.

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

There is currently no shared `LoadingButton` component - every busy/spinner
state is hand-rolled per call site with an inline `Loader2` +
`animate-spin` (seen in `BidEntry.tsx`, `Bidders.tsx`, `Checkout.tsx`,
`Receipts.tsx`). This is a real duplication - see
`refactor-opportunities.md`.

### Icon-Only Buttons

There is no dedicated `IconButton` component. Icon-only buttons currently
use `<Button size="icon">` (or `icon-xs`/`icon-sm`/`icon-lg`) directly and
must still carry an explicit `aria-label` - it is not enforced at the type
level the way it would be with a dedicated wrapper, so this needs manual
discipline until/unless that wrapper is built.

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

`src/components/ui/table.tsx` is the shared primitive; `Bidders.tsx`,
`Items.tsx`, `AuctionItemsTab.tsx`, `Checkout.tsx`, `Receipts.tsx` all
build their own table body/empty-state/search-bar scaffolding around it
independently rather than through a shared wrapper. That duplication
(search input + empty-state text + scroll container repeated per view)
is real and tracked in `refactor-opportunities.md` - it is not yet
solved by an existing `DataTableWrapper`-style component in this repo.

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

This app's dialog primitives are `dialog.tsx`, `alert-dialog.tsx`, and
`sheet.tsx` (a slide-over panel used for the bundling and edit flows).
There is no dedicated `ConfirmationDialog` wrapper component - destructive
confirmations are currently built ad hoc from `alert-dialog.tsx` per call
site (e.g. `BundlingDialog.tsx`). Extracting a shared confirmation dialog
is a reasonable follow-up, not something already done.

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
successful saves and background sync failures. Note `sonner.tsx` imports
`useTheme` from `next-themes` to pick its color scheme - this is the one
real place `next-themes` is wired into this app; it is not used for a
user-facing light/dark toggle anywhere else (`style_guide.md` correctly
says this app runs a single light theme with no in-app theme switcher).

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
inventing a second button/card/select pattern when this app's real ones
already cover the case. When a gap genuinely exists (no `IconButton`, no
`ConfirmationDialog`, no shared table wrapper, no `LoadingButton`),
building it is legitimate - but check `refactor-opportunities.md` first,
since these specific gaps are already logged there rather than being
undiscovered.
