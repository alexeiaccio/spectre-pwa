---
id: N8
title: Screen module skeleton prototype
type: prototype
status: closed
blocked_by: [N4, N6]
assigned: dev
---

## Question

A throwaway SolidJS skeleton that raises the fidelity of N6's discussion: the derived Screen union + a `switch` renderer + locked/setup/identities screens, with the identity detail stubbed to internal (non-URL) state. The point is to make "how it should behave" concrete — the current 527-line `App()` is the before; the skeleton is the after.

- Land on a throwaway branch / scratch dir; link the prototype as an asset from this ticket on resolution.
- Wire one vitest browser-mode test showing a guard transition (e.g. locked → deep-link → locked) — proves N2's harness on real navigation code.
- This is HITL: iterate with the human until the shape feels right; then N6's spec reflects it.

## Resolution

Prototype skeleton built and verified (2026-08-14). Lives in-tree, untracked, **nothing committed** (the working tree was already dirty with the in-flight lint/vitest/oxc work and must stay that way). `src/App.tsx` was not touched.

### Files created

- `src/lib/navigation/screen.ts` — the Screen union exactly as N6 pins it, plus
  `deriveScreen(vaultStatus, sessionStatus, url)` as a **pure function**. The
  guard/redirect decision rides as data alongside the screen:
  `ScreenDerivation = { screen, redirect }` with `redirect` = `{ kind: 'none' }`
  or `{ kind: 'redirect'; to; replace }`. Zero runtime imports (only `import
  type` from the two hooks), no DOM/router — the module stays pure and
  unit-testable. The shell applies the redirect imperatively.
- `tests/unit/screen-derivation.test.ts` — 22 unit tests: a 5×6 table (every
  VaultStatus kind × 6 URLs) asserting **both** the screen and the redirect —
  incl. deep-link-while-locked → `{ view: 'locked' }` + `redirect to '/locked'
  replace`, unmatched → redirect `/`, `/identity/` (no id) → redirect `/` — plus
  a 4-row sweep proving the `identity` screen carries each SessionStatus
  (idle/working/ready/error). Runs in the unit project.
- `src/prototypes/screen-module/AppShell.tsx` — throwaway render shell using
  the next.16 **config API** (`createRouter` / `defineRoutes` /
  `browserHistory` — not the 1.x `<Router>/<Route>` components). Routes: `/`,
  `/setup`, `/locked`, `/identity/:uuid`, `/*` catch-all; every route renders
  the same `ScreenShell`, so the router is purely the URL adapter and the
  derived Screen drives rendering + guards (`useNavigate(to, { replace })` from
  a two-arg `createEffect`). Identity stub reads the `useParams()` uuid but
  shows no secret. Status sources are passed as props via a context (see
  deviations).
- `tests/browser/screen-navigation.test.tsx` — 2 browser tests on the real
  chromium project (see guard-transition test below).
- `vitest.config.ts` — unit include widened to `tests/unit/**`, browser include
  widened to `tests/browser/*.test.{ts,tsx}` so the `.tsx` test is picked up.

### Toolchain move (N4 adoption)

One explicit install command landed the adopted versions in `package.json`
(`^` ranges): **`solid-js@2.0.0-rc.0`, `@solidjs/web@2.0.0-rc.0`,
`vite-plugin-solid@3.0.0-next.27`, `@solidjs/router@2.0.0-next.16`** (resolved
in `node_modules` exactly as installed). The rc.0 move broke nothing in the
existing suite: `npm test` = **56 passed** (the pre-existing 32 + 22 unit + 2
browser), `npm run build` (`tsc -b && vite build`) clean (0 warnings/errors),
`npm run lint` clean for new files (only pre-existing App.tsx warnings from the
in-flight refactor, untouched). Formatting of new files passes `oxfmt --check`.

### Router API used (per next.16, N1 §a)

`createRouter({ routes, history })` returns a render-prop component; routes are
plain objects (kept literal-typed by `defineRoutes`); `browserHistory()` is the
history-mode adapter; `useLocation`/`useNavigate`/`useParams` come from
`@solidjs/router`. Unmatched URLs hit the `/*` catch-all route and the
**derivation** redirects them to `/` — a union rule, not a route rule. The
router has no declarative guard API; the guard lives in the derived Screen, as
N4/N6 require.

### Guard-transition test (browser) — outcome

`tests/browser/screen-navigation.test.tsx` proves the N6 guard end-to-end:
`window.history.replaceState({}, '', '/identity/abc-123')` before render, then
render `AppShell` with a `{ kind: 'locked' }` vault status →
`[data-screen="locked"]` appears and **`window.location.pathname` becomes
`/locked`**. Real `browserHistory()` against the real vitest page URL worked
**as-is** — no memory-history fallback, no test-URL adapter needed. Second
test: unlocked + `/identity/abc-123` renders the identity stub with
`data-id="abc-123"` and keeps the URL. Both pass in ~20 ms on chromium.

### Deviations from N6 (and why)

- **Shell is prop-driven, not hook-driven.** `AppShell` takes
  `vaultStatus`/`sessionStatus` accessors as props (via a Solid context)
  instead of calling `useVault()`/`useIdentitySession()` internally. This keeps
  the browser test deterministic (no real IndexedDB/WebAuthn seeding) and
  avoids conditional-hook violations. Production wiring for the App hand-off
  passes the two real hooks.
- **All guard redirects are `replace: true`**, not just deep-link-while-locked.
  State-mismatch redirects (`/setup` or `/locked` while unlocked, unmatched URL,
  deep link while needs-setup) shouldn't add history entries; consistent with
  N6's "land on `/locked` (replace), never the deep link".
- **Already-at-target = no redirect.** If the URL is already the guard target
  (`/locked` while locked), no `replace` fires — avoids churning history.
- **`booting` never redirects.** Boot is transient; the redirect fires only
  once vault state resolves (locked / needs-setup).
- **Rendering uses `<Switch>`/`<Match keyed>` with per-variant memos, not a
  body-level `switch`.** Solid 2 rc dev-mode `STRICT_READ_UNTRACKED` flagged a
  body-level read of the derivation memo ("will not update") — reactive reads
  must stay inside JSX/memo compute scopes or the screen won't re-render on
  state change without a navigation. Real finding for the App refactor.

### Open issues / follow-ups for the hand-off

- **PR #566 params-bug relevance confirmed low.** The identity stub reads
  `useParams().uuid` and the derivation's parsed `id`; both matched on a fresh
  navigation in the browser test. The bug only bites *outgoing* components
  across navigation; the target shape never keeps identity detail mounted
  across routes. Keep watching PR #566 before any cross-route `useParams` use.
- Prototype lives in `src/prototypes/` (throwaway); the production `App`
  refactor (later hand-off) should absorb `src/lib/navigation/screen.ts` + the
  guard-effect pattern and wire the real hooks (see deviations).
- Bundle cost was **not** re-measured here: `AppShell` is imported only by the
  browser test, so the router does not enter the production bundle yet (N1's
  ≈ +11 KB gz eager figure stands as the measured estimate for when it does).
- Vitest unit-project include now covers `tests/unit/**`; the browser project
  covers `*.test.{ts,tsx}` — N9's suite layout can build on this.
