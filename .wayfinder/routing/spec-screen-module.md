# Screen module — hand-off spec

> Wayfinder routing effort · deliverable of N6, validated by N8 (prototype). Date: 2026-08-14.
> Status: **ready to implement**. Decisions source: `.wayfinder/routing/map.md`, tickets N4–N8.

## 1. Goal

Replace the navigation inside `src/App.tsx` (527 lines, 12 signals, 9 render gates, one hand-rolled back button) with a **Screen module**: a small seam whose interface is `current screen + navigate`, implemented as a **pure derivation** over the two existing hooks (`useVault`, `useIdentitySession`) and the URL. URL backing is provided by **`@solidjs/router@2.0.0-next.16`** (history mode) as the adapter *behind* the seam — it is not the enforcement mechanism.

## 2. The Screen union

```ts
type Screen =
  | { view: 'booting' }
  | { view: 'setup' }
  | { view: 'locked' }
  | { view: 'error'; message: string }
  | { view: 'identities' }
  | { view: 'identity'; id: string; status: SessionStatus }
```

- Vault-level error is a **screen, not a route**.
- **Future cases (Sync)**: `{ view: 'join' }` (internal steps, no per-step URLs) and `{ view: 'migrating' }` (transient) — room is made now, Sync ships the flow logic.
- `editingId` / `recent` / `copiedId` / `installPrompt` stay **local screen state** — not in the union.

## 3. Routes (history mode)

| Route | Screen |
|---|---|
| `/setup` | setup (needs-setup status) |
| `/locked` | locked |
| `/` | identities (when unlocked) |
| `/identity/:uuid` | identity detail — uuid only, **no names, no secrets** |
| `/*` (unmatched) | redirect `/` |

Guard/redirect rules (enforced by the derivation; router only renders):

- boot reads the URL → `needs-setup` → `/setup`; `locked` → `/locked`; `unlocked` → `/` or `/identity/:uuid` per URL; vault `error` → error screen.
- **Deep link while locked** → land on `/locked` (`replace`), never the deep link.
- Back from `/identity/:uuid` → `/`.
- All guard redirects use `replace: true`; no-op when already at the target; `booting` never redirects (N8).

## 4. Module shape (validated in N8)

- `src/lib/navigation/screen.ts` — union + **pure** `deriveScreen(vaultStatus, sessionStatus, url)` returning `{ screen, redirect }`. **Zero DOM/router imports** — unit-testable (N8's `tests/unit/screen-derivation.test.ts`: 22 table tests over status × URL).
- `src/App.tsx` refactor — replace the 9 gates with a switch over the derived screen; render screens as components with callback props (C4). **Solid 2 rc finding**: `STRICT_READ_UNTRACKED` forces **keyed `<Switch>/<Match>`** over a body-level switch (N8).
- `src/prototypes/screen-module/AppShell.tsx` — throwaway validation shell; **not** production code. The prototype was prop-driven (status accessors via context) for deterministic tests; the real App wires the hooks.

## 5. Secrets-off-URL boundary (fixed)

The URL never carries: identity full names, derived values, passphrases, recovery codes. Only the identity **uuid** reaches the URL (`/identity/:uuid`). Sync's join wizard steps and migration state are internal/transient — no URLs.

## 6. Lock-grace interplay

`useLockLifecycle` (`src/lib/lifecycle.ts`) stays as-is; on lock it drives the derivation to `locked` → the seam navigates (`replace`) to `/locked`. Returning to a deep link while locked lands on `/locked`, not the deep link (rule above).

## 7. Test surface

- **Unit** (node project): table test over `deriveScreen` — every status × URL → expected `{ screen, redirect }`, incl. deep-link-while-locked and unmatched-route cases.
- **Browser** (chromium project): `@solidjs/testing-library` renders `App` — each screen renders, back-button navigation, deep-link→locked redirect (N8's `tests/browser/screen-navigation.test.tsx` proves the pattern).

## 8. Toolchain (already landed)

- `solid-js` / `@solidjs/web` → `2.0.0-rc.0`, `vite-plugin-solid` → `3.0.0-next.27`, `@solidjs/router` → `2.0.0-next.16`.
- Vitest 4.1.10 browser mode; oxlint + oxfmt; all green (56 tests, build, lint).
- Router API is the next.16 config surface: `createRouter` / `defineRoutes` / `browserHistory` — **not** the 1.x component API (`<Router>/<Route>`).

## 9. Sync contract (N7)

Sync's S5 join flow + pairing section and S6 migration consume the seam as **screens/views only**: `join` (internal steps), `migrating` (transient). **No iroh/DEK/envelope knowledge leaks across the seam**; Sync ships flow logic behind screen components.

## 10. Hand-off checklist

- [ ] Add `{ view: 'join' }` and `{ view: 'migrating' }` cases when Sync lands.
- [ ] Watch `solidjs/solid-router` PR #566 (params bug) — low relevance (identity detail never stays mounted across routes; N8 confirmed `useParams().uuid` works).
- [ ] Router adds ≈ +11 KB gz eager (+12 KB precached-lazy) — accepted (N4).
- [ ] `vite.config.ts` `__dirname` deprecation warning is pre-existing, unfixed.
