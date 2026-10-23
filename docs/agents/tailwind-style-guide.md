# Tailwind CSS Style Guide

> **Status: written for this codebase's actual current state**, verified
> against `src/index.css`, `components.json`, and `package.json` on
> 2026-09-02. [`style_guide.md`](./style_guide.md) remains the primary
> authoritative source per `AGENTS.md`'s registry for this app's visual
> identity - this document exists alongside it to cover Tailwind-specific
> mechanics `style_guide.md` doesn't go into (token wiring, `cn()`,
> arbitrary values, class ordering). Where the two disagree, `style_guide.md`
> wins.
>
> **One correction worth flagging plainly**: `style_guide.md` currently
> lists Inter, Space Grotesk/Outfit, and JetBrains Mono/Fira Code as this
> app's type system. A repo-wide search found none of those - the only
> font actually imported or referenced anywhere in `src/` or `index.html`
> is **Geist Variable** (`@fontsource-variable/geist`, wired as
> `--font-sans` in `src/index.css`). Treat `style_guide.md`'s font section
> as stale until reconciled; don't add the other font families to match
> it, and don't build new UI assuming they exist.

This project uses:
- Tailwind CSS v4, CSS-first config (`@import "tailwindcss"` in
  `src/index.css`, via the `@tailwindcss/vite` plugin - no
  `tailwind.config.js`)
- `@import "shadcn/tailwind.css"` and `@import "tw-animate-css"` layered
  in alongside it
- `components.json`: shadcn style `base-nova`, base color `neutral`,
  `cssVariables: true`, no class prefix

---

## Color System - this app uses semantic CSS-variable tokens, not literal hex

Unlike some sibling projects, **this app's actual palette is the
standard shadcn `oklch()` CSS-variable system**, defined in
`src/index.css`'s `:root` / `.dark` blocks and re-exposed as Tailwind
colors via the `@theme inline` block: `--color-background`,
`--color-foreground`, `--color-card`, `--color-popover`,
`--color-primary`, `--color-secondary`, `--color-muted`,
`--color-accent`, `--color-destructive`, `--color-border`,
`--color-input`, `--color-ring`, plus `--color-chart-1..5` and a full
`--color-sidebar-*` set. Every real component in `src/components/ui/`
(`button.tsx`, `card.tsx`, `badge.tsx`, etc.) is styled with these
semantic classes - `bg-primary`, `text-muted-foreground`,
`text-card-foreground`, `bg-destructive/10`, `ring-foreground/10`, and so
on - not literal hex values.

There is exactly **one** literal brand color hardcoded as a token:
`--color-orns-red: #e31b23`, defined directly in the `@theme inline`
block in `src/index.css`. Use `text-orns-red` / `bg-orns-red` /
`border-orns-red` for that specific brand accent; use the semantic tokens
above for everything else. Don't invent new hardcoded hex values in
components - if a new brand color is genuinely needed, add it as a named
token in `src/index.css` the same way `orns-red` was added, not as an
inline `text-[#hexvalue]`.

### Dark mode infrastructure exists but is not user-facing

`src/index.css` defines a full `.dark` variable set, and `next-themes` is
a real dependency - but it's wired into exactly one place,
`src/components/ui/sonner.tsx`, to pick the toast color scheme. There is
no in-app light/dark toggle and no other component reads `next-themes`.
Don't build new UI assuming a dark-mode toggle is reachable by users;
`style_guide.md`'s "no unrequested theme selectors, single light theme"
guidance is accurate for anything user-facing.

---

## Conditional Classes: `cn()`

`cn()` exists at `src/lib/utils.ts`, wrapping `clsx` + `tailwind-merge`,
and is used throughout `src/components/ui/`. Use it for any conditional
class composition:

```tsx
className={cn(
  "rounded-lg px-4",
  isActive && "bg-primary text-primary-foreground"
)}
```

Avoid manual string concatenation or template-literal class building.

---

## Spacing

Use Tailwind's default spacing scale (`gap-1`/`p-1` for tiny, `gap-4`/`p-4`
default, `gap-6`/`p-6` for sections, `gap-8`/`p-8` for large). Per
`style_guide.md`, prefer intentional asymmetry over uniform padding
everywhere - large workflow sections at `p-8 md:p-10`, dialog/small
action areas at `p-4`/`p-6`. Avoid arbitrary spacing values (`mt-[13px]`)
unless matching an external constraint.

---

## Border Radius

This app derives its radius scale from a single `--radius` variable
(`0.625rem`) via calc-based tokens already defined in the `@theme inline`
block: `--radius-sm` through `--radius-4xl`, each a multiple of
`--radius`. Use the Tailwind classes those generate (`rounded-sm`
through `rounded-4xl`) rather than arbitrary radius values - the scale is
already richer than the shadcn default four-step scale, so there should
rarely be a reason to reach for `rounded-[Npx]`.

---

## Type Scale

Tailwind's default scale starts at `text-xs` (12px). This app adds exactly
one step below that: `--text-xxs: 0.625rem` (10px, paired with
`--text-xxs--line-height: 0.875rem`), defined in `src/index.css`'s
`@theme inline` block the same way `--color-orns-red` was added as a
one-off token. Use `text-xxs` for sub-`text-xs` micro-text - badge labels,
uppercase section eyebrows, italic helper notes - rather than an arbitrary
`text-[10px]`/`text-[11px]` bracket value; there is no sanctioned 11px
step, so a call site that needs "a little smaller than `text-xs`" should
use `text-xxs` (10px), not invent a new in-between arbitrary value.

One more step sits between `text-sm` (14px) and `text-base` (16px):
`--text-row-title: 0.9375rem` (15px, line height `1.375rem`), used as
`font-semibold text-row-title` for the name at the top of each list row
and winner card (BidderRow, ItemRow, AuctionItemRow, AttendeeRow,
WinnerCard). Those rows' number box is the shared `RowIdTile` component.

---

# Component Styling

Prefer the existing `variant`/`size` props on `Button`, `Badge`, `Card`,
etc. over one-off className overrides:

```tsx
<Button variant="destructive">Delete</Button>
```

not

```tsx
<button className="bg-destructive text-white rounded-lg px-4">
```

Every button/badge/card should not invent its own styling when a variant
already exists.

---

# Class Ordering

Maintain consistent ordering: layout - positioning - sizing - spacing -
typography - colors - borders - effects - states - responsive modifiers.
This is general Tailwind hygiene, not something this app enforces via
tooling - be consistent within a file at minimum.

---

# Arbitrary Values

Avoid `w-[347px]`-style arbitrary values; prefer the default scale.
Reasonable exceptions: matching an external asset's exact dimensions, or
a genuinely one-off layout constraint - not a substitute for adding a
proper token when the same value is about to be reused.

---

# Responsive Design

Design mobile-first, using Tailwind's default breakpoints (`sm`, `md`,
`lg`, `xl`, `2xl`). This app's tables (`Bidders.tsx`, `AuctionItemsTab.tsx`,
`Checkout.tsx`) are the components most likely to need real responsive
handling given how data-dense they are - prefer horizontal scroll via
`ScrollArea` (`src/components/ui/scroll-area.tsx`) over shrinking text.

---

# AI Generation Rules

When generating Tailwind for this app: use the semantic tokens
(`bg-primary`, `text-muted-foreground`, etc.) described above, not
literal hex, except for the one deliberate `orns-red` brand token. Use
`cn()` for conditional classes. Prefer existing `src/components/ui/`
variants over new styling. Avoid arbitrary values, avoid introducing new
hardcoded hex colors, avoid assuming a font family this app doesn't
actually load (see the Geist Variable correction above).

Before creating a new style, check whether `src/components/ui/` already
solves it - see `component-standards.md` and `file-reference.md`.
