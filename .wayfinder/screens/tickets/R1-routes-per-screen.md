---
id: R1
title: Route per screen + slim deriveScreen
type: refactor
status: open
blocked_by: []
assigned:
---

## Question

`App.tsx` currently has one `ScreenShell` that reads `deriveScreen(...)` into a `Screen` union and dispatches 7 `<Match>` cases. Every route mounts the same shell. Refactor so **each screen is its own route component** at its own path, with per-route reachability guards.

## Current structure (source of truth: `src/App.tsx`)

- `Router` routes: `/`, `/setup`, `/locked`, `/join`, `/identity/:uuid`, `/*` → all `ScreenShell`.
- `ScreenShell`:
  - `deriveScreen(vault.status, session.status, pathname)` → `{ screen, redirect }` (in `src/lib/navigation/screen.ts`).
  - `createEffect` applies `redirect` via `navigate`.
  - 7 memos (`booting`, `setup`, `locked`, `error`, `identitiesCase`, `identityCase`, `joinCase`) feed the `Switch`.
  - Data memos: `identitiesVault`, `identityDetail` (resolves `:uuid` → `Identity`).
  - Handlers: `onSaveIdentity`, `onDeleteIdentity`, `onAddSite`, `onUpdateSite`, `onDeleteSite`, `onUnlockIdentity`, `onDerive`, `onBack`.
  - Each `Match` renders a screen component with handlers passed as props.

## Target

- Each route component: `SetupScreen`, `LockedScreen`, `ErrorScreen`, `IdentitiesScreen`, `IdentityScreen`, `JoinScreen` + a booting placeholder. `ScreenShell` disappears (or shrinks to the booting/error wrapper if useful).
- Per-route guard: the route component reads vault/session status; if unreachable → `navigate` to the right home. Reuse a shared `useRouteGuard(predicate, fallback)` helper or keep `deriveScreen` but scoped per route.
- Handlers stay on `FlowApi` (already context-provided); route components pull what they need via `useContext(FlowContext)` instead of receiving props.
- `deriveScreen`'s `Screen` union: either decomposes per-route or the redirect logic moves into guards. Decide: keep a slim `deriveScreen` per route, or inline the guard in each route component.

## Acceptance

- Routes still serve the same URLs and redirect behavior (locked → `/locked`, setup → `/setup`, unmatched identity uuid → `/`).
- No `Switch`/`Match` over screens in `App.tsx` (only the booting/error wrapper if it stays).
- Each screen file is a self-contained route component reading `FlowContext`.
- 76 tests still green; browser tests exercise the real router.
