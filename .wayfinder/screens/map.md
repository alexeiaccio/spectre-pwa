# Spectre Pocket — Per-route screens + kebab-case files — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/screens/` — map, tickets, research live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

Replace the single `ScreenShell` switch (one component hosting 7 `<Match>` cases in `App.tsx`) with **one route per screen**, so each screen owns its route, data-fetching, and handlers. Along the way, rename screen files to **kebab-case** (`setup-screen.tsx` not `SetupScreen.tsx`) to match the repo's file convention.

Current shape (`src/App.tsx`):

- `ScreenShell` reads `deriveScreen(...)` → one `Screen` union → `Switch`/`Match` dispatches 7 cases: booting, setup, locked, error, identities, identity (`/identity/:uuid`), join.
- All routes (`/`, `/setup`, `/locked`, `/join`, `/identity/:uuid`, `/*`) mount the **same** `ScreenShell`.
- The shell owns the mutation handlers (`onSaveIdentity`, `onAddSite`, `onUpdateSite`, `onDeleteSite`, `onDeleteIdentity`, `onDerive`, etc.) and passes them as props to each screen.
- `FlowApi` (vault/session context) is provided above the `Router`.

Target shape:

- **Each screen becomes its own route component** mounted at its own path (guards + redirects live in a tiny per-route `guard` or a shared redirect helper).
- **`Screen` union + `deriveScreen` get slimmed**: the per-route guard only answers "is this route reachable in this vault state? if not, redirect where?" — no more central switch.
- **Shared handlers move to a hook or stay on `FlowApi`**, consumed by each route component directly (no prop-drilling through the shell).
- **Filenames kebab-case**: `setup-screen.tsx`, `locked-screen.tsx`, `error-screen.tsx`, `identities-screen.tsx`, `identity-screen.tsx`, `join-screen.tsx`, `site-fields.tsx` (+ `ui/*` already kebab-cased? verify).

## Decisions so far

<!-- one line per closed ticket -->

- R1 · Routes-per-screen vs single-shell — **done, as a route/screen merge**. The `ScreenShell`/7-`Match` switch is gone; screens are now **self-contained route components** — each reads `FlowContext` + `useScreen()` directly and is mounted straight in the router (`src/app.tsx`), so the `src/routes/` wrapper layer was deleted entirely. `deriveScreen` still drives redirects via `useScreen()`; `identity-screen` resolves its uuid from the URL, `error-screen` is the `/*` catch-all (booting/error). `FlowContext`/`FlowApi`/`useScreen` live in `src/lib/flow.ts`. Verified locked→unlock→identities flow + 80 tests.
- **Knip (2026-08-15): unused-file + dead-export cleanup.** Installed + configured `knip.json` (tests, spike, wasm counted as usage; green `npm run knip`). Deleted the obsolete `src/routes/` and `src/prototypes/screen-module/app-shell.tsx` (the old shell prototype this effort replaced), plus 22 dead exports (schema re-exports, `VaultStorageService` DI trio, hex helpers, spectre constants).
- **Settings route (2026-08-15): URL surface grew one route.** `/settings` added (unlocked-only, via `deriveScreen`) to host the add-identity form, passkey re-enroll, auto-lock, and sync/pairing cards; `/` is now a clean identity list (empty-state CTA + ⚙ Settings link when non-empty). Deliberately *not* a secrets-bearing route — identity detail stays on `/identity/:uuid`.
- **Passphrase wrap-under-DEK (2026-08-15): identity unlock no longer re-types.** The Spectre passphrase is stored as an optional field inside the DEK-encrypted identity record (`Identity.passphrase`), so the passkey unlock auto-unlocks identities. Security tradeoff, accepted by the human: whoever holds the vault DEK (passkey on a device, or the recovery code) can now also derive every password — the "unlock vault ≠ derive secrets" boundary collapses. The passphrase now travels inside synced, DEK-encrypted records (previously "never syncs"). Older records decode fine (optional field); a device that has an identity without a stored passphrase prompts once and then persists it.
- **Framework check (2026-08-15): no meta-framework / compiler swap.** `solid-start@next` (0.1.0-alpha.105) is a stale Solid-1-era alpha (peers `solid-js@^1.5`, `vite@^3`, `router@0.4`) and is SSR/server-oriented — wrong for an offline-only PWA. `dom-expressions@next` is already used transitively via `vite-plugin-solid`. `@tanstack/solid-start@beta` exists for Solid 2 but adds server machinery we don't need. Decision: stay on `@solidjs/router@2` + Vite, client-only. R1 continues.

## Tickets

- [R1 · Route per screen + slim deriveScreen](tickets/R1-routes-per-screen.md) — split the 7 `Match` cases into route components; per-route guards; keep `FlowApi` for shared handlers.
- [R2 · Kebab-case screen filenames](tickets/R2-kebab-case-files.md) — rename `src/screens/*.tsx` to kebab-case; update imports + any test references.

## Out of scope

- Changing the URL surface (routes stay `/`, `/setup`, `/locked`, `/join`, `/identity/:uuid`).
- Replacing `@solidjs/router` (it's the adopted router, per the Routing effort).
- Moving screens into `src/components/` or restructuring the ui kit further.
- The sync/join flow's logic (only its route shell changes).
