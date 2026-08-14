# N2 — Vitest browser-mode harness for SolidJS 2

> Ticket: `.wayfinder/routing/tickets/N2-vitest-browser-harness.md`
> Research date: 2026-08-13. Versions below verified against npm registry and the live docs on this date.
> Stack under test: Vite 8.2, solid-js `^2.0.0-beta.32` (resolves to **2.0.0-rc.0**), @solidjs/web 2.0.0-rc.0, vite-plugin-solid `^3.0.0-next.23` (resolves to **3.0.0-next.27**), TS ~6.0, Node 24.

## TL;DR — recommended harness

- **Vitest 4.1.10** (stable line; Browser Mode is stable, not beta). Do **not** use Vitest 5 (still `5.0.0-rc.1`, 2026-08-11).
- **Playwright provider** (`@vitest/browser-playwright`) + `playwright` npm package + `npx playwright install chromium`. Headless in CI via `browser.headless: true`.
- **Two projects** in one `vitest.config.ts` (`test.projects`): `unit` (node) and `browser` (chromium). No `vitest.workspace.ts` — workspace API is deprecated since Vitest 3.2.
- **`@solidjs/testing-library@1.0.0-beta.2`** (the Solid-2 beta) for component/navigation tests of `App.tsx`. Officially recommended by Vitest's own docs for Solid in browser mode.
- **Real IndexedDB + real WebCrypto** in the browser project — `fake-indexeddb` can be dropped from browser-project tests.
- **WebAuthn PRF**: replace the hand-rolled `navigator.credentials` mock with the **CDP virtual authenticator** (`cdp()` from `vitest/browser`, playwright+chromium only, `hasPrf: true`).
- `npm test` → `vitest run`; `npm run test:unit` / `test:browser` → `vitest run --project unit|browser`.

---

## (a) Vitest version, providers, browser installs, CI, stability

### Version
- Browser Mode was **experimental until Vitest 4.0** (released ~2025-11/12), which "removed the `experimental` tag". Source: https://vitest.dev/blog/vitest-4
- **Latest stable: `vitest@4.1.10`** (published 2026-07-06). `vitest@5.0.0-rc.1` published 2026-08-11, `5.0.0-beta.7` 2026-07-24 — still pre-release. Source: https://github.com/vitest-dev/vitest/releases, releasealert.dev/npmjs/@vitest/browser
- `vitest@4.1.10` `engines: node ^20 || ^22 || >=24` → **Node 24 OK**; `peerDependencies.vite: ^6 || ^7 || ^8` → **Vite 8.2 OK**. Source: https://registry.npmjs.org/vitest/4.1.10
- In Vitest 4 the context moved from `@vitest/browser/context` to **`vitest/browser`** (old path works until next major). Provider packages are separate: `@vitest/browser-playwright`, `@vitest/browser-webdriverio`, `@vitest/browser-preview`; `@vitest/browser` itself is bundled as a dependency of the provider package (no direct install needed). Source: https://vitest.dev/blog/vitest-4, https://vitest.dev/guide/browser/

### Playwright vs WebdriverIO provider
- Docs recommend **Playwright** ("supports parallel execution, which makes your tests run faster"); WebdriverIO only if you already use it. `preview` provider is a no-deps simulator and is **not for CI**. Source: https://vitest.dev/guide/browser/
- `playwright` provider browsers: `chromium | firefox | webkit`; `webdriverio`: `firefox | chrome | edge | safari`. Source: https://vitest.dev/guide/browser/#browser-option-types
- `@vitest/browser-playwright@4.1.10` peer deps: `vitest@4.1.10`, `playwright` (optional:false). Source: https://registry.npmjs.org/@vitest/browser-playwright/4.1.10

### Browser installs & CI
- Install `playwright` npm pkg (latest **1.62.1**, engines node >=20) then **`npx playwright install chromium`**. CI (e.g. GitHub Actions ubuntu): `npx playwright install --with-deps chromium`; cache `~/.cache/ms-playwright`. Source: https://www.npmjs.com/package/playwright, https://playwright.dev/docs/browsers
- Headless: `browser.headless: true` in config or `--browser.headless` on CLI; headless is **only** available with playwright/webdriverio providers. Source: https://vitest.dev/guide/browser/#headless
- Optionally opt into Playwright's new-headless real-Chrome: `provider: playwright({ launchOptions: { channel: 'chromium' } })`. Source: https://vitest.dev/config/browser/playwright
- Browser server defaults to port **63315** so it coexists with `vite dev`. Source: https://vitest.dev/guide/browser/#installation
- Security note: `CVE-2026-47429` (Vitest UI allows arbitrary file read/exec while the server is listening). Keep the browser server host `localhost` in CI (`browser.api.host`), never expose it. Source: https://github.com/advisories/GHSA-5xrq-8626-4rwp (referenced from Effect-TS/effect#5980).

### Stability
- Browser Mode is **stable** since Vitest 4.0 (Dec 2025). Not beta. It uses Vite dev server + BroadcastChannel; requires browsers Chrome >=87 / Firefox >=78 / Safari >=15.4. Source: https://vitest.dev/guide/browser/#browser-compatibility

---

## (b) solid-testing-library

- Package renamed: `@solidjs/testing-library` (the `solid-testing-library` npm name is deprecated/moved). Source: https://www.npmjs.com/package/solid-testing-library
- **Solid-2 compatible release: `@solidjs/testing-library@1.0.0-beta.2`** (dist-tag `next`, published **2026-06-25**). peerDeps: `solid-js >= 2.0.0`, `@solidjs/web >= 2.0.0`. deps: `@testing-library/dom ^10.4.1`. Source: https://registry.npmjs.org/@solidjs/testing-library
- Its `dist` confirms the Solid-2 shape: `import { render as solidRender } from "@solidjs/web"` + core (`createRoot`, `flush`, `onSettled`) from `solid-js`; renders into `document.body`; returns queries + `unmount`. Auto-cleanup registers **only if a global `afterEach` exists** at module load → enable `globals: true` in the browser project (or call `cleanup()` manually).
- **Browser vs jsdom**: it requires a DOM but is environment-agnostic — works under jsdom/happy-dom *and* under `@vitest/browser`'s real DOM. Vitest's docs explicitly recommend it for Solid in browser mode and show the bridge pattern: `render(() => <App/>)` then `page.elementLocator(baseElement)` for locators/assertions. Sources: https://vitest.dev/guide/browser/#examples, https://vitest.dev/guide/browser/component-testing#testing-library-integration
- Historical pain (not current): "Client-only API called on the server side" under Vitest 3 was a **resolve-conditions** bug in vite-plugin-solid (server build selected in test mode); fixed by vite-plugin-solid 2.11.1+ (PR #173 browser conditions, PR #217 SSR split). Sources: https://github.com/solidjs/vite-plugin-solid/issues/188, https://hy2k.dev/en/blog/2025/10-17-vitest-solid-browser-conditions/
- Solid 2 beta jsdom quirk (closed): `createProjection` infinite loop in jsdom fixed in 2.0.0-beta.15 (2026-06-24). Not a browser-mode blocker. Source: https://github.com/solidjs/solid/issues/2724

---

## (c) Migration path from `node --experimental-strip-types --test`

### Real IndexedDB / WebCrypto / WebAuthn in browser mode
- Browser mode runs in a **real browser**: real `indexedDB`, real `crypto.subtle`/`getRandomValues`, real `navigator.credentials`. The iframe is served from `localhost:63315` → a **secure context**, so SubtleCrypto and WebAuthn are available. → `fake-indexeddb` **can be dropped** for browser-project tests. Source: https://vitest.dev/guide/browser/
- **Isolation model**: isolation is **per test file**, not per test. Playwright provider creates a new BrowserContext per test file ("Vitest creates a new context for every test file"; "Vitest opens a single page to run all tests that are defined in the same file"). A fresh context = fresh origin storage (IndexedDB/localStorage/cookies), so files don't leak into each other. Sources: https://vitest.dev/config/browser/playwright (contextOptions/actionTimeout warnings), https://github.com/vitest-dev/vitest/discussions/10518
- **Within a file**, IndexedDB/WebAuthn state is shared across tests. The current pattern of `installEnv()` (fresh `IDBFactory` per test) must become `beforeEach`/`afterEach` DB reset, e.g. `await indexedDB.deleteDatabase('spectre-pocket')` (DB name from `src/lib/vault/schema.ts`), plus a fresh virtual authenticator per test where needed.

### WebAuthn — how the mock changes under a real browser
- `Object.defineProperty(navigator, 'credentials', ...)` cannot work in a real browser (`navigator.credentials` is non-configurable), and the `location` override (`tests/re-enroll.test.ts:14-17`) isn't needed because the real origin is localhost. **Replace both with a CDP virtual authenticator:**
  - `import { cdp } from 'vitest/browser'` (playwright provider + chromium only; gated by `browser.api.allowWrite`/`allowExec`, which default to `true` when the server isn't exposed to the network). Sources: https://vitest.dev/api/browser/context#cdp, https://vitest.dev/config/browser/api#api-allowwrite
  - Setup per test file: `WebAuthn.enable` → `WebAuthn.addVirtualAuthenticator` with `{ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true }`. The `VirtualAuthenticatorOptions` include **`hasPrf`** ("the authenticator will support the prf extension"). Source: https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
  - The app's flow (PRF eval **at create** + usernameless `get()` with `allowCredentials: []`, `src/lib/vault/passkey.ts`) maps to the WPT `createcredential-prf.https.html` / `getcredential-prf.https.html` tests, which run the virtual authenticator with `protocol: "ctap2_1"`, `extensions: ["prf"]` — Chromium recently wired up PRF-at-create for virtual devices. **Verify empirically in a spike** (see Open questions). Sources: WPT files in chromium.googlesource.com, chromium commit 5c0c8ab "webauthn: support evaluating PRFs during create()".
  - Since the authenticator is scoped to the BrowserContext (= per test file), remove it between tests (`WebAuthn.removeVirtualAuthenticator`) or re-add in `beforeEach` for per-test isolation.
- `Buffer.from(...)` (`tests/re-enroll.test.ts:58-59`) is Node-only → replace with a small hex helper (or `Uint8Array` comparison).

### Per-test-file mapping

| File | Today | Recommended project | Notes |
|---|---|---|---|
| `spectre-algorithm.test.ts` | pure vectors (WebCrypto via algorithm) | **unit (node)** | pure; needs no DOM. `crypto` exists in Node 24. |
| `mutations.test.ts` | pure | **unit (node)** | trivially node. |
| `crypto-dek.test.ts` | WebCrypto (AES-GCM wrap/unwrap) | **unit (node)** | identical WebCrypto in Node — no DOM needed. |
| `spectre-session.test.ts` | WebCrypto non-extractable HMAC | **unit (node)** | same as above. |
| `prefs.test.ts` | fake-indexeddb | **browser** | real IndexedDB; drop fake-indexeddb; reset DB in `beforeEach`. |
| `re-enroll.test.ts` | fake-indexeddb + credentials mock | **browser** | real IndexedDB + CDP virtual authenticator (PRF). |
| `App.tsx` (527 lines, untested) | — | **browser** | new component/navigation tests via `@solidjs/testing-library` + `page.elementLocator`. |

- All 6 files must switch `import { test } from 'node:test'` / `import assert from 'node:assert/strict'` to `vitest` (`import { expect, test } from 'vitest'`). Vitest does not run `node:test` files.
- `node --experimental-strip-types` friction is **moot**: Vitest transforms TS through Vite/esbuild. `.ts`-extension imports (`../src/lib/...ts`) and TS ~6.0 work unchanged; type errors are not part of the test run (`tsc -b` in `npm run build` is unaffected).
- Note: in browser mode the module namespace is sealed, so `vi.spyOn` on an imported module throws; use `vi.mock(path, { spy: true })` instead. Source: https://vitest.dev/guide/browser/#limitations

---

## (d) Exact packages + config + `npm test`

### devDependencies to add
```
vitest@^4.1.10
@vitest/browser-playwright@^4.1.10
playwright@^1.62.1
@solidjs/testing-library@next   # 1.0.0-beta.2 (Solid 2)
# optional: @vitest/coverage-v8@^4.1.10
```
`fake-indexeddb` stays only if any test keeps running IndexedDB in the node project (recommendation: drop after the browser migration above). `@vitest/browser` does **not** need a direct install.

### vitest.config.ts (single config, two projects)
```ts
import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  test: {
    projects: [
      {
        extends: true,               // inherit plugins from root config
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.{ts,tsx}', 'tests/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright({ launchOptions: { channel: 'chromium' } }), // optional new-headless
            headless: true,           // CI + local
            instances: [{ browser: 'chromium' }],
            viewport: { width: 390, height: 844 }, // PWA small-screen
          },
          globals: true,             // needed for @solidjs/testing-library auto-cleanup (afterEach)
        },
      },
    ],
  },
})
```
- `test.projects` is the current API; `vitest.workspace.ts` is deprecated since 3.2. Source: https://vitest.dev/guide/projects
- Run: `npm test` → `"vitest run"` (CI) / `"vitest"` (watch); `"test:unit": "vitest run --project unit"`, `"test:browser": "vitest run --project browser"`. `--project` filter: https://vitest.dev/guide/projects#running-tests
- `vitest init browser` scaffolds the same provider setup if preferred. Source: https://vitest.dev/guide/browser/#installation
- **vite-plugin-solid v3 handles Vitest posture automatically** — its config hook detects `mode === 'test'` and: node-environment projects get the server posture (inlines `solid-js`/`@solidjs/web`); DOM projects get client posture; browser-mode projects are *not* defaulted to jsdom (avoids the "jsdom not installed" probe failure) and skip jest-dom setup files because browser mode bundles its own assertions. Vite 8 is handled (`rolldownOptions.transform.jsx: 'preserve'`). Source: `@solidjs/vite-plugin@3.0.0-next.28` dist (`config()` hook, inspected 2026-08-13), https://registry.npmjs.org/@solidjs/vite-plugin
- So the old jsdom-only workaround (`resolve.conditions: ['browser']` + `ssr.resolve.conditions: ['browser']`) is **not needed** for browser mode — only for jsdom-env projects on the v2 plugin line.
- **Tailwind v4 (`@tailwindcss/vite`) coexists** with vitest browser mode; CSS is processed by Vite, and vitest's default `css: false` just stubs CSS imports in assertions. Harmless to include; omit if you want a faster config.
- **Do not include `vite-plugin-pwa` in the test config** (workbox runs `transformIndexHtml`/build-time work for nothing). Use a dedicated `vitest.config.ts` rather than reusing `vite.config.ts` (or guard VitePWA with `process.env.VITEST`).
- **tsconfig impact**: none required. No path alias exists in this repo (relative `../src/...ts` imports), so no `resolve.alias` needed. If aliases are added later, mirror them in `resolve.alias` of the vitest config. `jsxImportSource` is already `@solidjs/web` (`tsconfig.app.json:18`). Optionally add `"types": ["vitest/globals"]` if you rely on globals instead of explicit imports.

---

## (e) Blockers and risk register

No hard blockers found for the pinned stack (all peer ranges verified against npm on 2026-08-13):

| Item | Status |
|---|---|
| Vitest 4.1.10 ↔ Vite 8.2 | ✅ peer `^6\|\|^7\|\|^8`; Node 24 engine ✅ |
| solid-js `^2.0.0-beta.32` → 2.0.0-rc.0, @solidjs/web 2.0.0-rc.0 (2026-08-12) | ✅ rc, same 2.0.0 pre-release range |
| vite-plugin-solid `^3.0.0-next.23` → 3.0.0-next.27 (2026-08-12), wraps `@solidjs/vite-plugin` 3.0.0-next.28 | ✅ first-class Vitest test-posture handling; Vite 8 support built in |
| `@solidjs/testing-library@1.0.0-beta.2` (2026-06-25) | ✅ peer `solid-js >=2.0.0`, `@solidjs/web >=2.0.0`; renders into real DOM |
| effect `^4.0.0-beta.107` | ✅ pure-TS browser runtime; tests call `Effect.runPromise` directly, so `@effect/vitest` is not needed (if ever adopted, it requires vitest ^4.1 per @effect/vitest@4.0.0-beta.103) |
| `node --experimental-strip-types` | ✅ irrelevant — vitest/esbuild transforms TS |
| WebAuthn PRF via CDP virtual authenticator | ⚠️ documented (`hasPrf`), WPT-covered, PRF-at-create recently wired in Chromium — **spike to confirm** on the pinned Chromium build; may need `protocol: 'ctap2_1'` |
| Within-file state sharing (IndexedDB, WebAuthn creds) | ⚠️ per-file contexts only → per-test `deleteDatabase` + authenticator reset needed |
| Vitest 5.0 | ⏳ RC only (5.0.0-rc.1, 2026-08-11) — pin 4.1.x; re-evaluate when 5.0 goes stable |
| `vi.spyOn` on imported modules in browser | ⚠️ use `vi.mock(path, { spy: true })` |
| CVE-2026-47429 (Vitest UI) | ⚠️ keep `browser.api` host localhost-only in CI |

### Recommended order for N6/N9
1. Land `vitest` + `@vitest/browser-playwright` + `playwright`, two-project config, migrate the 4 node tests → unit project (pure find/replace of imports).
2. Move `prefs.test.ts` and `re-enroll.test.ts` to the browser project with real IDB + CDP virtual authenticator (keep them green against the current mock temporarily if the CDP spike drags).
3. Spike: CDP virtual authenticator PRF (`hasPrf`, protocol ctap2 vs ctap2_1) with `createPasskeyWithPrf`/`getPrfOutput` before committing to dropping the WebAuthn mock.
4. Add `App.tsx` component tests (render + `page.elementLocator`, `userEvent` from `vitest/browser`).
5. N9: `npm test` = `vitest run`; CI job installs chromium with `--with-deps` and caches `~/.cache/ms-playwright`.

### Open questions
- Does the CDP virtual authenticator with `hasPrf: true` return deterministic, app-compatible PRF output for **PRF-eval-at-create** on the pinned Chromium, and does `get()` with `allowCredentials: []` resolve the resident credential? (Empirical spike.)
- Does `@solidjs/testing-library@1.0.0-beta.2` auto-cleanup fire reliably in browser mode with `globals: true`, or do we need explicit `cleanup()` in an `afterEach`? (Vitest's `Symbol.for('vitest:component-cleanup')` hook is wired for its own render packages; testing-library's is its own `afterEach`.)
- Any Solid 2.0 **stable** release timing that would bump `@solidjs/testing-library` past 1.0.0-beta.2 (it only ships on the `next` tag today)?
- Should `crypto-dek`/`spectre-session` move to the browser project after all, to exercise the same real-WebCrypto path as production (small PWA — slow vs. "test what you ship" tradeoff)? Human direction (map.md:23) leans browser-mode-everything; node keeps them fast.
