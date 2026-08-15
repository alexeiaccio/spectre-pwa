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

- R1 · Routes-per-screen vs single-shell — **in progress**. Chart the split; the `identity/:uuid` route is the tricky one (validates the id, needs the session).

## Tickets

- [R1 · Route per screen + slim deriveScreen](tickets/R1-routes-per-screen.md) — split the 7 `Match` cases into route components; per-route guards; keep `FlowApi` for shared handlers.
- [R2 · Kebab-case screen filenames](tickets/R2-kebab-case-files.md) — rename `src/screens/*.tsx` to kebab-case; update imports + any test references.

## Out of scope

- Changing the URL surface (routes stay `/`, `/setup`, `/locked`, `/join`, `/identity/:uuid`).
- Replacing `@solidjs/router` (it's the adopted router, per the Routing effort).
- Moving screens into `src/components/` or restructuring the ui kit further.
- The sync/join flow's logic (only its route shell changes).
