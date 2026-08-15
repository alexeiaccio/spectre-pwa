# Spectre Pocket — A11y: forms, names, and tests — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/a11y/` — map, tickets, research live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

Make every input-driven flow behave like a real form and be fully operable by
keyboard + assistive tech:

1. **Enter submits** — inputs are currently bare Kobalte TextFields outside any
   `<form>`, so pressing Enter in a focused input does nothing. Wrap each
   input+primary-action group in a native `<form>` whose primary button is
   `type="submit"` → Enter submits natively.
2. **Accessible names** — inputs carry only placeholders; add real `<label>`s
   (Kobalte `label`) and `autocomplete` where the browser knows the field
   (recovery code, current-password, name). Give icon-only buttons
   (`✕`, copy, back) `aria-label`s.
3. **Regression tests** — a browser test pins the structure: each flow has a
   form whose submit fires the right handler, every input is reachable by its
   label, icon-only buttons are named.

Not in scope: a full axe audit, focus-trapping, or redesign of the B/W theme.

## Form inventory

| Screen | Fields | Primary action |
| --- | --- | --- |
| `setup-screen` | recovery code | Create vault (passkey) |
| `locked-screen` | recovery code | Unlock with code |
| `identity-screen` (idle) | passphrase | Unlock identity |
| `identity-screen` (ready) | site name / edit | Add site / Save |
| `settings-screen` | full name + passphrase | Add identity |
| `settings-screen` | recovery code (re-enroll) | Replace passkey |
| `join-screen` (unlock) | recovery code | Unlock with code |
| `join-screen` (invite) | invitation string | Join |
| `join-screen` (recovery) | recovery code | Unlock & join |

## Decisions so far

<!-- one line per closed ticket -->

- A1 · Native `<form>` + Enter-to-submit — **done.** Every input flow (setup, locked, identity unlock, add/edit site, settings add-identity + re-enroll, join unlock/invite/recovery) wraps its inputs in a native `<form>` with the primary action as `type="submit"`; `Button` gained a `type` prop. Verified live: Enter in the locked screen's recovery-code field unlocks. Secondary actions stay `type="button"`.
- A2 · Accessible names — **done.** `Input`/`Textarea` gained `label` + `autocomplete`; every field is labelled; `autocomplete` set to `current-password`/`new-password`/`name` where the browser knows the field; icon-only buttons (delete identity, copy value) carry `aria-label`.
- A3 · A11y regression tests — **done.** `tests/browser/a11y.test.tsx` (6 tests): submit wiring per flow, labelled fields, named icon-only buttons.

## Tickets

- [A1 · Native `<form>` + Enter-to-submit](tickets/A1-forms-and-enter-submit.md) — wrap each flow in a form; primary button becomes `type="submit"`; `Button` grows a `type` prop.
- [A2 · Accessible names](tickets/A2-accessible-names.md) — `label` + `autocomplete` on `Input`/`Textarea`; `aria-label` on icon-only buttons.
- [A3 · A11y regression tests](tickets/A3-a11y-tests.md) — browser project: submit wiring, labelled inputs, named icon buttons.

## Out of scope

- Switching off Kobalte or the Solid 2 two-arg `createEffect` shape.
- Keyboard trap / focus management beyond native form semantics.
- Visual restyle beyond the minimal label styling needed for a11y.
