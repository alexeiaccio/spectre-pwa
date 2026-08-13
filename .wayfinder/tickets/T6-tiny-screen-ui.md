---
id: T6
title: Tiny-screen UI model for identities and derived results
type: grilling
status: resolved
blocked_by: []
assigned:
---

## Question

Ikko Mind One == small portrait screen, thumb-first, no desktop aesthetics. Define the interaction model:

- Identity picker when vault locked (passkey list w/ plaintext names) → unlock → then what: per-identity site list (saved from vault metadata) + a "site name" quick-add; tapping a site reveals its derived password/login/answer.
- Result copy semantics: tap-to-copy? auto-clear clipboard after N seconds? Show-as-you-type vs reveal-on-tap.
- Navigation depth budget for the screen size (keep ≤2 levels); whether the passphrase entry and identity picker fit on one screen.
- Dark-only theme (matches spectre.app), font scale for small display, and what's deliberately omitted in v1 (animations, images).

## Resolution

Closed 2026-08-11 · superseded decisions from T2/T4 (plaintext identity names dropped; lock screen is passkey/recovery only) folded in. Implemented in `src/App.tsx` + `src/index.css`:

- **Identity picker lives after passkey unlock**, not on the lock screen (T2: nothing user-visible plaintext at rest). Unlocked → identity list → per-identity site list. This is the v1 navigation shape.
- **Navigation depth = 2 levels max**: `identities → sites`. Passphrase entry sits on the identity screen (not its own level); the "← identities" back button closes the drill-down.
- **Reveal-on-tap, then tap-to-copy.** Tapping a site row derives and reveals the value *inline* in that row (no separate panel). Tapping the revealed value copies it and flashes "copied". The clipboard self-clears after **30s** (`src/lib/lifecycle.ts`). No show-as-you-type — nothing is stored, so there is nothing to type ahead.
- **Touch targets:** all primary buttons and inputs ≥ **44px** via a `tap` Tailwind utility (`min-height: 2.75rem`) — thumb-first, no hover dependence for action.
- **Theme:** dark-only (`surface-900`), spectre teal accent, `user-select: none` except inputs; mono font for derived values. Font scale stays default (`text-sm`) — small screens need density, not magnification.
- **Deliberately omitted in v1:** animations, images/illustration, hover-only affordances, desktop layouts, multi-column, context menus (long-press). Every interactive element is a full-width tap target.
- **Site quick-add** is an inline form on the sites screen (name + purpose + template + optional security question), matching "site name quick-add" from the question.

Status → **resolved**.