# N1 — solid-router fit for this deployment

**Date:** 2026-08-13 · **Status:** Research complete → decision-ready for **N4** · **Repo:** `/Users/a.tukachev/github/spectre-pwa` (Vite 8, `solid-js ^2.0.0-beta.32` → lockfile `2.0.0-beta.32`, `@solidjs/web ^2.0.0-beta.32` → `2.0.0-beta.32`, vite-plugin-solid `3.0.0-next.23`, vite-plugin-pwa 1.3.0, workbox-build 7.x, Cloudflare Worker SPA deploy)

All version/date/peer facts below were read directly from the npm registry, the published package tarballs, the installed workbox source, Cloudflare docs, and the repo's own `dist/sw.js` (verified), not from memory.

---

## Summary of the answer

| Q | Answer | Blocker? |
|---|---|---|
| **(a)** Version line & Solid 2 compat | `latest` = **1.0.0** (2026-07-28) is **Solid 1.x-only** (peer `solid-js ^1.8.6`). The Solid-2 line only exists on the `next` tag: **2.0.0-next.16** (2026-08-12), peer `solid-js ^2.0.0-rc.0` + `@solidjs/web ^2.0.0-rc.0`. There is **no stable Solid-2 router**, and **no docs** for the 2.0 line. The `beta` dist-tag is stale (0.10.0-beta.9, 2023-12-06). | ⚠️ Not a hard blocker; see the two wrinkles in §(a). |
| **(b)** hash vs history under THIS deploy | **Both work.** History-mode routes are app-shelled by **both** layers: CF Worker `not_found_handling="single-page-application"` serves `index.html` with **200 OK** for unmatched paths (verified: Cloudflare docs; repo `wrangler.toml:16`), and workbox `navigateFallback` serves the **precached** shell for every navigation (verified in repo `dist/sw.js` + `node_modules/workbox-precaching` source: `NavigationRoute(createHandlerBoundToURL('/index.html'))` pins the request + cacheKey to `index.html` → served from precache, **no network**, online or offline). No 404. Hash-mode is still the *lower-risk* choice for an offline-first vault PWA: it removes all dependence on both fallback layers and keeps route state client-only. | No. |
| **(c)** Feature fit | Guards = app state, exactly as the review concluded (9 of the app's gates are lock lifecycle, not navigation — the router ships no declarative guard API anyway; redirect is an imperative `useNavigate('/locked', {replace:true})`). Nested routes + outlets, params (`useParams`, optional `:id?`, wildcards `*`, `matchFilters`), and `lazy()` all exist in the 2.0-next line. **Partial routing is fine**: nothing forces one routing model — a catch-all route can render the internal-state (identity-detail) screens while only outer screens (setup / locked / identities) are URL-backed. | No. |
| **(d)** Bundle cost | Measured in a real Vite build (rc.0 + plugin next.27): **≈ +11 KB gz eager** (main chunk 21.1 KB gz vs 10.2 KB gz control), plus **≈ +12 KB gz** of *precached-but-never-run* lazy chunks (seroval `decode` + `serverForms`) that workbox downloads at install but that only load if the router's action/server-form path is used (it never is here). bundlephobia agrees: 1.0.0 = 9.9 KB gz, 2.0.0-next.16 = 11.3 KB gz, 0 runtime deps. Hand-rolled Screen module + thin adapter ≈ 0.5–1.5 KB gz, zero deps. | No. |
| **(e)** vs hand-rolling | The Screen module (pure derived union, C1/C3) is required either way — it is not "router code". The only incremental hand-roll is the thin URL adapter (`popstate`/`hashchange` listener + `pushState`/`replace` + read), ~30–80 LOC, 0 deps, no version risk. Router adoption buys back-button/deep-link for 3 outer screens and a future join-wizard host at the price of ~11 KB gz + Solid-rc toolchain churn + an API that differs from its own docs and moved its peer floor 3 times in 8 days. | No — recommendation nuance, not a blocker. |

**Bottom line for N4:** there is no *blocker* to adopting `@solidjs/router` (it is actively maintained, the Solid-2 line is live on `next`, and coexistence with vite-plugin-pwa/workbox is officially exercised). But the router adds no capability the hand-rolled seam lacks for this app, costs ~11 KB gz + a forced move to `solid-js@2.0.0-rc.0` + `vite-plugin-solid@3.0.0-next.27` (fresh installs would do this anyway), and its 2.0 API is still shaking out (no stable release, no docs, README≠package, one open "params broken" PR). The low-risk path is: build the Screen seam + thin adapter now, revisit the router when `@solidjs/router` ships a stable Solid-2 release.

---

## (a) Version line and SolidJS 2 compatibility

### Registry facts (read from `registry.npmjs.org/@solidjs/router`, checked 2026-08-13)

| Dist-tag | Version | Published | peerDependencies |
|---|---|---|---|
| `latest` | **1.0.0** | 2026-07-28 | `solid-js ^1.8.6` — Solid 1.x only |
| `next` | **2.0.0-next.16** | 2026-08-12 | `solid-js ^2.0.0-rc.0`, `@solidjs/web ^2.0.0-rc.0` |
| `beta` | 0.10.0-beta.9 | 2023-12-06 | `solid-js ^1.8.6` — stale, effectively dead |

- The Solid-2 line is a **from-scratch rewrite**, versioned on the `next` tag through three renames: `0.17.0-next.*` (from 2026-03-18) → `1.0.0-next.*` (from 2026-07-22) → `2.0.0-next.*` (from 2026-07-29). Today: `2.0.0-next.16`.
- **Peer floor moved 3 times in 8 days** — the tell-tale of a fast-moving target:
  - `2.0.0-next.14` (2026-08-05): peer `>=2.0.0-beta.30 <2.0.0-experimental.0` — **compatible with the repo's solid-js beta.32**
  - `2.0.0-next.15` (2026-08-11): peer `>=2.0.0-beta.33` — NOT compatible with beta.32
  - `2.0.0-next.16` (2026-08-12): peer `^2.0.0-rc.0` — requires the rc line
- **solid-js itself:** `latest` = 1.9.14, `next` = **2.0.0-rc.0** (published 2026-08-12). The repo's lockfile pins `2.0.0-beta.32` (published 2026-08-07). Note: `^2.0.0-beta.32` in package.json *would* resolve to `2.0.0-rc.0` on a fresh install today, and vite-plugin-solid `^3.0.0-next.23` would then resolve to `3.0.0-next.27` — which is exactly the version pair the router next.16 needs. **The repo is one clean `npm install` away from being on rc.0 already.**
- **Toolchain wrinkle:** the repo's pinned `vite-plugin-solid@3.0.0-next.23` has peer `>=2.0.0-beta.32 <2.0.0-experimental.0` — it *rejects* solid-js rc.0 (npm ERESOLVE, reproduced). Only `vite-plugin-solid@3.0.0-next.27` (2026-08-12) dropped its peerDependencies entirely and admits rc.0. So adopting router `next.16` implies **solid-js, @solidjs/web → rc.0 AND vite-plugin-solid → next.27**, not just the router.
- **Docs mismatch (flag):** `docs.solidjs.com/solid-router` states "The docs are based on latest Solid Router. To use this version, you need to have Solid **v1.8.4** or later installed." — i.e. docs are 1.x-only. The GitHub README (`main`) still shows the component API (`<Router>`, `<Route>`, `<A>`, `<Navigate>`, `<HashRouter>`), but the published `2.0.0-next.16` **does not export those components**. Its real surface (from the package `.d.ts`/`dist`) is: `createRouter(config) → RouterInstance` (a render-prop component), `defineRoute`/`defineRoutes`, `browserHistory`/`hashHistory`/`memoryHistory`, hooks (`useNavigate`, `useLocation`, `useParams`, `useSearchParams`, `useMatch`, `useIsRouting`, `useBeforeLeave`, …), and the SSR/data layer (`query`, `revalidate`, `action`, `useAction`, `useSubmissions`). README ≠ package today.
- **Maintenance health:** actively maintained by Ryan Carniato (Solid core team); main-branch commits through 2026-07-28; `next` releases through 2026-08-12. npm: ~265k weekly downloads, 89 dependents, 0 runtime deps, MIT, 2 maintainers, 34 open issues / 9 PRs. **Not unmaintained.** One open bug against the 2.0 line: PR #566 "params becoming undefined in outgoing components during navigation" (created 2026-07-06, still open, changeset pending).

## (b) Hash-mode vs history-mode under THIS deployment

Verified end-to-end, no assumptions:

1. **Worker layer:** Cloudflare static assets with `not_found_handling = "single-page-application"` serve `/index.html` with **200 OK** for any request that doesn't match a static asset (Cloudflare docs: "serve the contents of the /index.html file with a 200 OK status"). The repo's compat date is `2024-11-01` (< `2025-04-01`), so navigation requests still invoke the worker (`src/worker.ts` → `env.ASSETS.fetch(request)`), which applies the same SPA fallback. **History-mode deep links do NOT 404.**
2. **SW layer:** the repo's emitted `dist/sw.js` contains `registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")))`. Reading workbox-precaching 7.x source: `createHandlerBoundToURL('/index.html')` builds a handler whose `cacheKey` is the precached `index.html` entry, so `PrecacheStrategy._handle` **serves the precached shell for every navigation request — synchronously, no network, online or offline**. Any history route is app-shelled.
3. Therefore **history-mode is functionally safe here**; the app is not forced to hash-mode by the deploy. The one workbox + query-strings gotcha that exists (vite-pwa issue #653: navigations with `?param=` and `navigateFallback` mis-behaving) is configurable via `ignoreURLParametersMatching` and is irrelevant to this app (no query-string routes today; the shell is served regardless; the router reads the query client-side).
4. **Why hash-mode is still the lower-risk default for this product:**
   - Zero dependence on *either* fallback layer: `#/locked` never triggers a worker or SW decision — cold launch always lands on `/`, which is precached. The offline claim stops resting on `not_found_handling` + `navigateFallback` being right in every deploy.
   - The fragment is never sent to the worker/server — routes are client-only by construction (a nice-to-have for a secrets-adjacent vault; the outer-screen URLs are non-secret, so this is defense-in-depth, not a requirement).
   - `start_url: '/'` and scope are origin-based — identical for both modes; no installability difference.
   - The 2.0-next router has both adapters (`browserHistory` / `hashHistory`), so mode is a one-line choice behind the seam.
   - **Future invite caveat (S5):** a QR invite deep link `https://host/#/join?payload=…` works fine (cold start → `/` → precached shell → hash+query read client-side), and keeps the payload off the server. **Web Share Target**, if it ever lands, delivers share data via **query params (GET) or body (POST), never the fragment** (MDN/spec) — so the share `action` should be `/` or `/join` and the app reads `location.search` on boot, then routes. Both routing modes are compatible; just don't expect share payloads in the hash.
5. **Known solid-router ↔ PWA interaction:** none conflicting. `vite-plugin-pwa` maintains an official `examples/solid-router` (Vite + vite-plugin-solid + VitePWA `navigateFallback:'index.html'`, plus an injectManifest `claims-sw.ts` doing exactly `NavigationRoute(createHandlerBoundToURL('index.html'))`) and official `docs/frameworks/solidjs.md` — the combination is exercised in-tree. Router navigations (`pushState`/`hashchange`) never hit the network, so workbox doesn't intercept them; only full page loads/refresh are navigations, and both are covered above.

## (c) Feature fit

- **Guards / redirects (locked/booting must force the locked screen):** the 2.0-next router has **no declarative guard API** — no `<Navigate>` component, no `redirect()` throw helper (both exist in the 1.x line / SolidStart, not in next.16's export list). The supported pattern is imperative: render your derived screen and call `useNavigate()('/locked', { replace: true })`, or render the catch-all with internal-state logic. This matches the review's conclusion precisely: the 9 gates are **lock-lifecycle app state, not navigation** — the router would be a thin adapter *behind* the Screen seam, not the enforcement mechanism. `useBeforeLeave` exists (for blocking navigation, e.g. unsaved forms) but the app has no dirty-route-leave case worth guarding (add-site form is transient; secrets never leave the current screen).
- **Nested routes + outlets:** supported. In the 2.0-next model, nesting is via `children` in `defineRoutes`/`createRouter` and outlet content is passed through the render-prop / `props.children` (no `<Outlet>`/`<Routes>` components; the 1.x README describes the older component API).
- **Params:** `useParams`, optional `:id?`, wildcards `*`, `matchFilters` all present in next.16. Caveat: an open PR (#566) reports params flipping to `undefined` in *outgoing* components during navigation in the 2.0 line — relevant only if the app keeps an identity-detail component mounted across navigations (it won't; identity detail stays internal).
- **Lazy:** route-level `lazy()` is supported (`LazyRouteChildren` in the types), but the map already declares code-splitting out of scope ("tiny offline PWA", `map.md:42`) — and a single eager bundle is what keeps the workbox precache atomic.
- **Partial routing / "does the library impose one model?":** **No.** The router matches only the URLs you give it. You can URL-back *only* setup / locked / identities and let a catch-all (or a non-route component inside the identities branch) own identity detail, derived values, and passphrase in internal state. That is the fixed secrets-off-URL boundary (`map.md:19`) and the depth budget (≤2 levels, `map.md:20`); both are satisfied. The join wizard (S5) can host its steps as routes or internal state without breaking either.
- Extra machinery the app will never use: the 2.0-next router is built for SolidStart-style SSR + data layer (`query`/`action`/`singleFlight`, hydration/claims). It costs bytes and peer churn; it contributes zero value to an offline-only client PWA.

## (d) Bundle cost (measured, not estimated)

Real Vite 8 build in a scratch app, same toolchain family as the repo (solid rc.0, `vite-plugin-solid` next.27, esbuild min, gzip):

| Variant | Main JS | gz | Notes |
|---|---|---|---|
| Control (rc.0 + 3 tiny components, no router) | 25.4 KB | **10.2 KB** | |
| + `@solidjs/router@2.0.0-next.16` (createRouter + browserHistory + useParams, history routes) | 54.7 KB | **21.1 KB** | eager delta **≈ +11 KB gz** |
| …lazy chunks emitted alongside (`decode`=seroval, `serverForms`) | +35.9 KB | +12.1 KB | **dynamic `import()`**, never fetched in this app, but workbox precaches them at install (+12 KB gz to install/download) |

Cross-check: bundlephobia — `@solidjs/router@1.0.0` = 26.7 KB min / **9.9 KB gz**; `@solidjs/router@2.0.0-next.16` = 31.2 KB min / **11.3 KB gz**; 0 runtime dependencies. The repo's whole current app is 96.6 KB raw / 32.5 KB gz, so the router is **≈ +34% of the app's JS weight** (or ≈ 0.9 KB gz if you count only what this app needs and ignore the lazy/SSR parts — it does not work that way; the eager graph is the honest number).

**Hand-rolled seam:** the Screen module (pure derived union over VaultStatus + SessionStatus, C1/C3) is app code that exists in *both* worlds — it is not an alternative to the router, it is the seam N6 specs. The only incremental hand-roll is a **thin URL adapter**: read + parse `location`, `popstate`/`hashchange` listener, `history.pushState`/`replaceState` writer, back-button wiring — ~30–80 LOC, **zero deps, ≈ 0.5–1.5 KB gz** after min. So the router is roughly a **7–10×** byte cost vs the adapter, buying features this app doesn't consume (params/query/lazy/actions/SSR data).

## (e) Comparison to hand-rolling (given this app's needs)

| | `@solidjs/router` 2.0.0-next.x | Hand-rolled Screen + thin adapter |
|---|---|---|
| Back button / deep link for outer screens (setup / locked / identities) | ✔ | ✔ (same `history`/`hash` primitives) |
| Guards (locked/booting) | app-side anyway — no declarative guard in next.16 | app-side (the derived Screen union) |
| Secrets off URL (identity detail) | ✔ partial routing / catch-all | ✔ by construction (URL never holds them) |
| Join wizard (S5) hosting, ≤2 levels | ✔ routes or internal | ✔ internal steps or hash segment |
| Bundle | **≈ +11 KB gz eager** (+12 KB gz precached-lazy) | ≈ +0.5–1.5 KB gz |
| Deps / version risk | 0 runtime deps, but peer churn (3 floor moves in 8 days), no stable release, docs = 1.x, README ≠ package, open params bug (PR #566) | 0 deps, no risk |
| Testing (Vitest browser mode, N2) | `memoryHistory` adapter exists | `createSignal`-driven Screen is trivially testable |
| Operational cost of switching later | Revisit when stable 2.x lands | seam keeps the router a *candidate adapter* behind the same interface |

The review's framing holds: **solid-router is a candidate adapter behind the seam, not a replacement for it** (`map.md:18`). Nothing in the router forces a different architecture on this app; conversely, nothing the app needs is missing from the seam. The decision N4 weighs is essentially: *pay ~11 KB gz + rc-toolchain churn today for a pre-1.0 router whose API is still moving*, versus *ship the zero-dep seam now and re-evaluate the router when it goes stable*.

---

## Blockers / explicit call-outs

1. **No stable Solid-2 router exists.** `latest` (1.0.0) is Solid 1.x-only. The only Solid-2 line is `next` = 2.0.0-next.16 (2026-08-12). **Not a blocker** (the line is actively maintained and buildable), but it is pre-release software with a moving peer floor.
2. **Docs/package mismatch for the 2.0 line:** official docs say Solid 1.8.4+; GitHub README shows the 1.x component API; the published next.16 exports a *different* config-based API (`createRouter`/`defineRoutes`/history adapters). Any dev on this app would be working from `.d.ts` files, not docs.
3. **Peer/ecosystem coupling (reproduced):** router next.16 + solid-js rc.0 requires `vite-plugin-solid@3.0.0-next.27` (the only release without peer caps). `npm i @solidjs/router` against the repo's current lockfile state fails resolution unless all three move together. A fresh install (no lockfile) would land there anyway.
4. **Workbox/pwa: no conflict found** — coexistence is officially exercised in `vite-plugin-pwa`'s own `examples/solid-router`, and the repo's `navigateFallback` + worker SPA fallback together make history-mode 404-free (verified). The router's lazy SSR/data chunks (`decode`/`serverForms`) do get precached even though unused (+12 KB gz install weight).
5. **2.0 params bug:** open PR #566 against the next line (params → `undefined` in outgoing components) — low relevance here (identity detail stays internal), but it signals the 2.0 line is not yet battle-hardened.

## Open questions for N4/N6

- Adopt **now on `next` (2.0.0-next.16 + solid rc.0 + plugin next.27)**, or **build the seam + thin adapter now and re-evaluate when a stable Solid-2 router ships**? (Recommendation leans to the latter; nothing here blocks it.)
- If the router is adopted: **hash or history?** Both work under this deploy; hash is the lower-risk default (no dependence on fallback plumbing, routes never leave the client). No forced choice.
- Does the S5 join wizard need **shareable/deep-linkable invite URLs**, and will it use Web Share Target? Fragment deep links work for QR invites; Web Share Target delivers via query, so the share `action` should be `/`-rooted, never a hash route. Decide in S5, but the seam must expose "read boot URL query/fragment once".
- Does `useBeforeLeave` ever matter (unsaved add/edit-site form on back/close)? Cheap to add behind the seam later; not needed at MVP.
- Watch `solidjs/solid-router` PR #566 before depending on `useParams` across sibling/outgoing routes in any future screen.

## Sources

- npm registry `@solidjs/router` (dist-tags, per-version peers + publish dates): https://registry.npmjs.org/@solidjs/router
- npm registry `solid-js` (dist-tags incl. `next: 2.0.0-rc.0`, beta/rc publish dates): https://registry.npmjs.org/solid-js
- npm registry `vite-plugin-solid` (peer caps per `3.0.0-next.*`; next.27 has no peers): https://registry.npmjs.org/vite-plugin-solid
- Published tarball `@solidjs/router@2.0.0-next.16` (exports, `dist/` layout, `defineRoute`/`createRouter`/`browserHistory`/`hashHistory`/`memoryHistory`, full export list, peer `^2.0.0-rc.0`): unpacked locally in scratch build (npm pack)
- Releases (next.15/next.16 notes — rc.0 peer move rationale, seroval/SSR eager-graph removal): https://github.com/solidjs/solid-router/releases
- GitHub repo + main-branch activity (last commits 2026-07-28; README component API): https://github.com/solidjs/solid-router
- Open bug "2.0 router params are broken", PR #566: https://github.com/solidjs/solid-router/pull/566
- docs.solidjs.com solid-router (explicitly "Solid v1.8.4 or later"): https://docs.solidjs.com/solid-router ; HashRouter (1.x) reference: https://docs.solidjs.com/solid-router/reference/components/hash-router
- Cloudflare static assets — `not_found_handling = "single-page-application"` serves `/index.html` with 200 OK; nav requests vs worker invocation (`assets_navigation_prefers_asset_serving` / compat date): https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ and https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- Repo-generated `dist/sw.js` (`NavigationRoute(createHandlerBoundToURL('/index.html'))`) + installed `node_modules/workbox-precaching` (`PrecacheController.createHandlerBoundToURL`, `PrecacheStrategy._handle`) — served from precache for every navigation, no network
- workbox-build `navigateFallback` docs: https://developer.chrome.com/docs/workbox/modules/workbox-build/
- vite-plugin-pwa official Solid/Router example + Solid framework doc (`examples/solid-router`, `docs/frameworks/solidjs.md`): https://github.com/vite-pwa/vite-plugin-pwa/tree/main/examples/solid-router , https://vite-pwa-org.netlify.app/frameworks/solidjs.html
- workbox + navigateFallback + URL-params gotcha (vite-pwa #653, `ignoreURLParametersMatching`): https://github.com/vite-pwa/vite-plugin-pwa/issues/653
- bundlephobia (1.0.0 = 9.9 KB gz; 2.0.0-next.16 = 11.3 KB gz): https://bundlephobia.com/api/size?package=@solidjs/router@2.0.0-next.16
- Web Share Target — payload via query (GET) / body (POST), not fragment; action within scope: https://w3c.github.io/web-share-target/ and https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
- Solid 2.0 migration guide — `solid-js/web → @solidjs/web`, `jsxImportSource: "@solidjs/web"`: https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md
- Solid 2.0 beta announcement / roadmap phases (router listed as an ecosystem project to land before stable): https://github.com/solidjs/solid/discussions/2596 and https://github.com/solidjs/solid/discussions/2425
