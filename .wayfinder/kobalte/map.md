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

- K1 · Adopt auto-lock selector as the first Kobalte component — **unblocked by a dependency patch.** Root cause of the frozen popover: `@solid-primitives/controlled-signal` next.3 wraps its write in `untrack()`, which Solid 2 rc.0 strict mode drops from a non-owner context. Patched via `patch-package` (write outside `untrack`, read stays untracked) + `postinstall`. The auto-lock Select now **opens, selects, closes, and persists** (verified; trigger shows the value across reload).
- K3 · **TextField is adoptable** (no popover machinery) — **done**. All text inputs use Kobalte TextField: site name, security answer (SiteFields), full name, passphrase, re-enroll code (IdentitiesScreen), identity passphrase (IdentityScreen), recovery codes (Locked/Setup/Join). Verified add-identity + add-site through TextFields, zero warnings.
- K4 · **NumberField is adoptable**. Counter input now uses Kobalte NumberField (`value`/`onChange` + `minValue`); verified counter → row `#N` propagates. Its `STRICT_READ_UNTRACKED` warnings are **cosmetic** (value still flows), unlike Select's broken open.

## Tickets

- [K1 · Auto-lock selector via Kobalte Select](tickets/K1.md) — **done** (unblocked by the controlled-signal patch): open/select/close/persist verified.
- [K2 · Site form selects via Kobalte Select](tickets/K2.md) — **now unblocked** (same patch fixes the Select); purpose/template selects in SiteFields are the next target.
- [K3 · Text inputs via Kobalte TextField](tickets/K3.md) — **done**: site name, security answer, full name, passphrase, recovery codes all on TextField.
- [K4 · Spectre counter via Kobalte NumberField](tickets/K4.md) — **done** (counter in SiteFields).

## Out of scope

- Replacing everything with a design system (Kobalte is unstyled; we keep the Tailwind B/W theme).
- Adopting corvu or corvu-next (no form primitives for Solid 2).
- Adding Kobalte components with no current use (Menubar, Calendar, Drawer, etc.).
- Migrating to a Solid-1 Kobalte just for stable Select — the alpha is rc.0-compatible and adoption is incremental.
