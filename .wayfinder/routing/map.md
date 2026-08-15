# Spectre Pocket Routing — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/routing/` — map, tickets, research, prototypes live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

A **decision + spec** for Spectre Pocket's navigation, plus the **DX harness** that lets the implementation be tested and verified. Navigation track: the **Screen module** seam (interface = `current screen + navigate`), URL-backed outer screens via **@solidjs/router** (adopted, N4); pin the **derived Screen union** over VaultStatus + SessionStatus, the **secrets-off-URL** boundary (identity detail stays internal), and the **test surface**. Tooling track — **lint/format** (Oxc: **oxlint** + **oxfmt** + `vite-plugin-oxlint`, per N5) and **Vitest browser mode** — lands here (execution). The navigation track delivers a spec to hand off; Sync's **S5 join-flow** and **S6 migration** build on the seam.

## Notes

- Domain: SPA navigation, SolidJS 2 (beta), PWA/service-worker routing, WebAuthn vault security, small-screen UX, DX tooling.
- Skills sessions should consult: `wayfinder`, `grill-with-docs`, `domain-modeling`, `prototype`, `research`, `code-review`, `vkvideo-testing`.
- Built on delivered **Spectre Pocket v1** (`.wayfinder/map.md`) alongside the in-progress **Sync** effort (`.wayfinder/sync/map.md`). S5 (join wizard, pairing) and S6 (migration state) are Sync's; this map guarantees the seam can host them and is not blocked by them.
- Standing decisions from the 2026-08-13 architecture review (report: `/var/folders/nr/v79_zy4n1y501j69qzmh8xzm0000gp/T/architecture-review-20260813-133343.html`):
  - C1 + C3 are **Strong**: one Screen module whose interface is `current screen + navigate`, implemented as a **pure derivation** over the two hooks; collapses 9 render gates, 7 guard copies (`App.tsx:133–233`), the unsafe cast at `App.tsx:333`, and the six-signal lock reset (`App.tsx:137–146`).
  - **solid-router is a candidate adapter behind the seam, not a replacement for it** — most of the 9 gates are app state (lock lifecycle), not user navigation.
  - **Secrets never reach the URL**: identity detail, derived values, passphrase — internal state only. URL backing covers setup / locked / identities.
  - Depth budget: navigation ≤2 levels (identities → sites, T6). The seam must absorb the join wizard's steps without exceeding it.
  - C4 (split flow controller from screens) and C5 (single clipboard auto-clear) are follow-on cleanups — out of this map unless they surface as blockers.
- Infrastructure is already router-ready and unused: `wrangler.toml:16` SPA fallback, workbox `navigateFallback` (vite.config.ts), static worker `src/worker.ts`.
- Tooling direction from the human (2026-08-13): **Vitest browser mode** is the test harness (real browser DOM, IndexedDB, WebCrypto — no fake-indexeddb needed); lint/format = **Oxc toolchain — `oxlint` + `oxfmt`** + `vite-plugin-oxlint` (REVISED: the human dropped ESLint + Prettier; N3's `eslint-vite` finding is moot — there is no ESLint Vite plugin). Solid rules ride in via oxlint `jsPlugins` (`eslint-plugin-solid`). Current runner: Vitest 4.1.10, 6 test files (32 tests) migrated (N9).

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [N1 · solid-router fit for this deployment](tickets/N1-solid-router-fit.md) — **No stable Solid-2 router**; the Solid-2 line is `next` = 2.0.0-next.16 (peer `solid-js ^2.0.0-rc.0`). Both hash & history are 404-free under this deploy (CF SPA fallback + workbox `navigateFallback` verified); hash = lower-risk default. Router has **no declarative guards** (app-state), partial routing fine. ≈ +11 KB gz eager (+12 KB precached-lazy) vs ≈ 0.5–1.5 KB gz hand-rolled. Adopting now forces `solid-js`→rc.0 + `vite-plugin-solid`→3.0.0-next.27.
- [N2 · Vitest browser-mode harness for SolidJS 2](tickets/N2-vitest-browser-harness.md) — **Vitest 4.1.10 browser mode** (stable) + Playwright provider, two `test.projects` (`unit` node + `browser` chromium) in one config. `@solidjs/testing-library@1.0.0-beta.2` for Solid 2. Real IndexedDB/WebCrypto in browser → drop `fake-indexeddb`. WebAuthn PRF via CDP virtual authenticator (`hasPrf:true`, spike to verify). 4 test files → node, `prefs`+`re-enroll` → browser; `App.tsx` → new browser component tests.
- [N3 · Lint + format stack facts for this deployment](tickets/N3-lint-format-stack.md) — **`eslint-vite` does not exist** (security holding package); lint runs standalone. `eslint-plugin-solid@0.14.5` is peer-capped at **ESLint 9 (EOL 2026-08-06)**; ESLint-10 support unmerged PR #207. Prettier 3.9.6 + `prettier-plugin-tailwindcss` 0.8.1 (needs `tailwindStylesheet`). **Biome 2.5.8** = credible single-tool alt with native Solid rules, no Tailwind sorting.
- [N4 · Router adoption](tickets/N4-router-adoption.md) — **Adopt `@solidjs/router@2.0.0-next.16` now**; move `solid-js`/`@solidjs/web` → `2.0.0-rc.0` + `vite-plugin-solid` → `3.0.0-next.27` (one clean install lands there anyway). The router is the **URL adapter behind the Screen seam (N6)** — outer screens only (setup/locked/identities); guards stay in the derived union; secrets stay off the URL. hash-vs-history deferred to N6 (hash = lower-risk default, verified both work).
- [N5 · Lint + format tooling choice](tickets/N5-lint-format-choice.md) — **oxlint 1.78.0 + oxfmt 0.63.0** (REVISED; human overrode the ESLint/Prettier choice — "we do not need prettier and eslint"). Solid rules via `jsPlugins: ["eslint-plugin-solid"]` (structural OK; `solid/reactivity` type-aware → degraded). Vite overlay = `vite-plugin-oxlint` 2.1.2 (the "vite plus"; `vite-plus` product rejected). Tailwind v4 sorting via oxfmt `sortTailwindcss`. `printWidth: 80`, `semi:false, singleQuote:true`. Removes eslint.config.js/.prettierrc/@nabla wiring.
- [N9 · Land Vitest browser mode](tickets/N9-land-vitest.md) — **Landed**: vitest@4.1.10 + playwright provider, two `test.projects` (`unit` + `browser` chromium) in one config, `@solidjs/testing-library` for component tests. 6 files migrated (4 → unit, prefs/re-enroll → browser with **real IndexedDB**, fake-indexeddb dropped). **CDP WebAuthn PRF spike succeeded** (`ctap2`, `hasPrf:true`). **32 tests green**, build green. Caveat: a repo `.npmrc` `legacy-peer-deps=true` was added for the testing-library install — flagged, N10 won't rely on it.
- [N10 · Land lint + format](tickets/N10-land-lint-format.md) — **Landed (Oxc, REDO)**: `oxlint ^1.78.0` + `oxfmt 0.63.0` (exact-pin) + `vite-plugin-oxlint` 2.1.2 overlay + `eslint-plugin-solid` via `jsPlugins`. `.oxlintrc.json` + `.oxfmtrc.json` (`printWidth:80, semi:false, singleQuote:true`, `sortTailwindcss` v4). Deleted `eslint.config.js`/`.prettierrc.json`/`.prettierignore`/nabla wiring. **lint 0/0, format clean, 32 tests + build green.** Caveats: `.npmrc legacy-peer-deps` kept (N9) + `eslint@9` stays as inert devDep (jsPlugins load path); `solid/reactivity` runs structurally (no type-awareness, accepted).
- [N6 · Shape of the Screen module](tickets/N6-screen-module-shape.md) — **History mode** + **uuid route**: routes `/setup`, `/locked`, `/`, `/identity/:uuid` (error = screen, not a route; unmatched → redirect `/`). **Screen union** = pure derivation over (VaultStatus, SessionStatus, URL); guard rules enforce app-state (deep link while locked → `/locked` replace; back from identity → `/`). Sub-UI (`editingId`/`recent`/`copiedId`/installPrompt) stays local. **Test surface**: unit table-test over the derivation + browser component tests (render/back/redirect). Spec → `.wayfinder/routing/spec-screen-module.md`.
- [N7 · The seam's contract with Sync S5/S6](tickets/N7-sync-s5-s6-contract.md) — Join wizard (S5) = **`{ view: 'join' }` union case, internal steps, no per-step URLs**, entry links on setup + locked. Pairing section = inline on identities (no case). S6 migration = distinct **`{ view: 'migrating' }`** case. The seam **never imports iroh/envelope/DEK** — union names views only; Sync ships flow logic behind screen components.
- [N8 · Screen module skeleton](tickets/N8-screen-module-skeleton.md) — **Prototype landed**: `src/lib/navigation/screen.ts` (pure `deriveScreen` → `{ screen, redirect }`), 22 unit table-tests, throwaway `AppShell.tsx` on `@solidjs/router` next.16 (`createRouter`/`defineRoutes`/`browserHistory`), 2 browser tests. Toolchain moved per N4 (rc.0 + plugin next.27 + router next.16) — **56 tests + build + lint green**. **Real finding**: Solid 2 rc `STRICT_READ_UNTRACKED` forces keyed `<Switch>/<Match>` over a body-level switch. Guard redirects all `replace:true`, no-op at target, `booting` never redirects.
- **CI wiring (2026-08-15)** — `.github/workflows/ci.yml` landed (the routing map's last fog item): oxlint, oxfmt `--check`, tsc, vitest unit + browser (playwright chromium install + cache), and the build — on push + PR.

## Not yet specified

- **Invitation deep links / Web Share target** (opening a QR invite from outside the app) — needs Sync S5 before it's sharp enough to ticket. The seam's URL surface is ready (`/join` root, query read on boot, per N1 §(b)).

## Spec

The effort's destination (decision + spec, hand off) is reached — **`.wayfinder/routing/spec-screen-module.md`**.

## Implementation (2026-08-14)

The Screen module was **implemented** per the spec (human: "start implementing routing"):

- `src/App.tsx` rewritten — `@solidjs/router` history routes `/setup`, `/locked`, `/`, `/identity/:uuid`, `/*` → the derived Screen union via keyed `<Switch>/<Match>`; guards enforced by `deriveScreen` (`src/lib/navigation/screen.ts`, now also redirects unknown uuids to `/`).
- Screens extracted to `src/screens/`: `Header`, `Setup`, `Locked`, `Error`, `Identities`, `Identity`, `SiteFields` (shared). Flow controller lives in `ScreenShell` (App.tsx); sub-UI state stays local to the screens.
- `useInstallPrompt` extracted to `src/lib/pwa.ts`; `useIdentitySession` now tracks `identityId` (a ready session for another identity is treated as idle + auto-locked — fixes the identity-switch stale-session bug).
- Optimistic vault layer (`createOptimistic`) preserved; per-row "Deriving…" indicator added in `IdentityScreen`.
- Tests: `tests/browser/screen-navigation.test.tsx` now drives the real `App` with injected fake hooks (3 browser tests: deep-link-while-locked → `/locked`, identity uuid route, unlock → identities). Derivation unit suite extended (unknown-uuid redirect). **58 tests / lint 0-0 / format clean / build green.**

Sync's S5 (join) and S6 (migration) attach via the union cases `join` + `migrating` per the contract in §9.

## Out of scope

- The **S5 Join wizard / pairing sections** themselves — Sync's effort, consumes this seam.
- The **S6 migration view** — Sync's effort.
- **Lazy-loading / route-level code splitting** — tiny offline PWA.
- **Server-side routing / SSR** — worker serves a static SPA shell.
- **URL-backed identity detail or any secret in the URL** — fixed boundary.
- **Any bundler/framework change beyond the tooling named above** (no new runtime deps for routing without N4's decision).
