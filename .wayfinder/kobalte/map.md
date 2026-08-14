# Spectre Pocket — Kobalte form components — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/kobalte/` — map, tickets, research, prototypes live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

Replace the app's native form controls with **Kobalte** (`@kobalte/core` Solid 2 alpha) components — the native `<select>` (purpose/template on site forms, auto-lock), plain `<input>`/`<select>`/`<option>` are inconsistent on small-screen mobile (especially WebView-embedded platforms like the Ikko Mind One). Adoption target: **Select, TextField, NumberField** (and Combobox if a free-text+pick use case appears). Outcome: consistent touch/keyboard behavior, accessible `data-*` states styled by the existing Tailwind theme, no bespoke dropdown code.

## Verified ground truth (2026-08-14)

- **`@kobalte/core@2.0.0-alpha.0`** (`npm tag alpha`) peer-requires **`solid-js@2.0.0-rc.0` + `@solidjs/web@2.0.0-rc.0`** — exactly this repo's versions. No overrides needed.
- **Import shape: per-component subpaths**, NOT the root barrel. `import { Root, Trigger, Value, Content, Item } from '@kobalte/core/select'` resolves cleanly under `moduleResolution: bundler`; `import { Select } from '@kobalte/core'` fails (exports map has `./*` but no `.` root). Same for `@kobalte/core/text-field`, `/number-field`, `/combobox`.
- **API is collection-based** in this alpha: `Select.Root` takes `options: CollectionNode[]`; `Select.Item` takes an `item` node (not a bare `value`). `.Root/.Trigger/.Value/.Content/.Item` compound members exist as named exports. This differs from Kobalte 0.13's `value`-based Select — the alpha's exact collection ergonomics must be pinned by the first real component (K1).
- Solid 1.x stable Kobalte and corvu **cannot** be used (peer-require `solid-js@^1.x`); corvu-next has **no form primitives** (Select/TextField/NumberField absent).

## Decisions so far

<!-- one line per closed ticket -->

- K1 · Adopt auto-lock selector as the first Kobalte component — **closed as blocked**. The alpha Select renders (trigger/value/theme) and its API is pinned (subpath imports, scalar value, render-prop `selectedOption()`), but **the popover never opens** (`aria-expanded` stays false, options don't mount) and Kobalte's own `ButtonRoot` emits `STRICT_READ_UNTRACKED` warnings under Solid 2 rc.0 strict mode. Both are library-side. **Reverted to native `<select>`.** Revisit when `@kobalte/core` alpha ships a Solid-2-rc-clean release; K1 is the re-entry test. Fallback if it doesn't mature: hand-rolled headless Select.
- K3 · **TextField is adoptable** (no popover machinery). Site-name + security-answer inputs now use Kobalte TextField; verified typing + optimistic add works, zero warnings.
- K4 · **NumberField is adoptable**. Counter input now uses Kobalte NumberField (`value`/`onChange` + `minValue`); verified counter → row `#N` propagates. Its `STRICT_READ_UNTRACKED` warnings are **cosmetic** (value still flows), unlike Select's broken open.

## Tickets

- [K1 · Auto-lock selector via Kobalte Select](tickets/K1.md) — **closed (blocked)**: API pinned, open toggle broken, reverted.
- [K2 · Site form selects via Kobalte Select](tickets/K2.md) — blocked on a working Kobalte alpha (purpose/template selects still native).
- [K3 · Text inputs via Kobalte TextField](tickets/K3.md) — **in progress**: site-name + security answer done; remaining: full name, passphrase, recovery code.
- [K4 · Spectre counter via Kobalte NumberField](tickets/K4.md) — **done** (counter in SiteFields).

## Out of scope

- Replacing everything with a design system (Kobalte is unstyled; we keep the Tailwind B/W theme).
- Adopting corvu or corvu-next (no form primitives for Solid 2).
- Adding Kobalte components with no current use (Menubar, Calendar, Drawer, etc.).
- Migrating to a Solid-1 Kobalte just for stable Select — the alpha is rc.0-compatible and adoption is incremental.
