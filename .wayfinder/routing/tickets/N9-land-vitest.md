---
id: N9
title: Land Vitest browser mode
type: task
status: closed
blocked_by: [N2]
assigned: dev
---

## Question

Manual setup that unblocks N6's test surface and N8's prototype: install and configure the harness N2 specifies.

- Add `vitest` + `@vitest/browser` (+ provider per N2), `vitest.config` aligned with the existing Vite config.
- Migrate the 6 existing `tests/*.test.ts` to run under vitest — browser mode where the tests touch IndexedDB/WebCrypto/WebAuthn (drop `fake-indexeddb` where real browser storage suffices), node mode for pure algorithm vectors.
- Wire `npm test`; keep `npm run build` green.
- Resolved when the full suite runs under vitest. Record resulting facts (config, packages, any dropped deps) in the resolution.

## Resolution

Closed 2026-08-13. Full suite green under vitest: **6 files, 32 tests passed**; `npm run build` (`tsc -b && vite build`) green.

### Packages added (devDeps)
- `vitest@^4.1.10` (4.1.10) — NOT 5.x (still RC)
- `@vitest/browser-playwright@^4.1.10` (4.1.10)
- `playwright@^1.62.1` (browsers: `npx playwright install chromium` — chromium-1234 already cached on this machine)
- `@solidjs/testing-library@^1.0.0-beta.2` (1.0.0-beta.2)
- Dropped: `fake-indexeddb` (no longer referenced; real IndexedDB in the browser project)

`solid-js`/`@solidjs/web`/`vite-plugin-solid` stayed at the lockfile pins (solid-js 2.0.0-beta.32); no version bump happened during install, and the build still passes.

### `.npmrc` (new)
`legacy-peer-deps=true` — required because `@solidjs/testing-library@1.0.0-beta.2` declares peer `solid-js >= 2.0.0` / `@solidjs/web >= 2.0.0`, but both are at the pre-release `2.0.0-rc.0`-line (rc < stable in semver, so the strict peer check rejects). `npm ls` reports these as `invalid`; runtime is unaffected (imports resolve fine). If a stable solid-js 2.0.0 ever lands, drop the flag.

### `vitest.config.ts` (new; `vite-plugin-pwa` deliberately excluded)
Single config, two `test.projects` (no workspace file — deprecated since Vitest 3.2), both `extends: true` from the root `[solid(), tailwindcss()]` plugins:
- root `test.environment: 'node'` + `testTimeout: 30000`
  - root `environment: 'node'` is a workaround: vite-plugin-solid's `config()` hook force-sets `test.environment = 'jsdom'` when none is set in test mode (`vite-plugin-solid/dist/esm/index.mjs:1838`), which made vitest probe for the uninstalled `jsdom` package ("MISSING DEPENDENCY jsdom") and would fail in a no-TTY CI.
  - `testTimeout: 30000` because the unit tests run memory-hard scrypt (~2–12 s/test) and the parallel browser project steals CPU; the 5000 ms default flakes.
- `unit` project: `environment: 'node'`, include `tests/*.test.ts`.
- `browser` project: include `tests/browser/*.test.ts`, `globals: true` (for @solidjs/testing-library auto-cleanup), `browser.enabled`, `provider: playwright()`, `headless: true`, `instances: [{ browser: 'chromium' }]`, viewport 390×844, `api: { host: 'localhost' }`.
  - `api.host: 'localhost'` (loopback-only ⇒ CVE-2026-47429 safe) is also mandatory for WebAuthn: rpId comes from `location.hostname` and IPs (`127.0.0.1`) are rejected as invalid WebAuthn domains; `localhost` is the spec's exempt loopback host.

### Per-file mapping
| File | Project | Notes |
|---|---|---|
| `tests/spectre-algorithm.test.ts` | unit | `node:test` → `vitest`; `assert.*` → `expect` |
| `tests/mutations.test.ts` | unit | same |
| `tests/crypto-dek.test.ts` | unit | same |
| `tests/spectre-session.test.ts` | unit | same |
| `tests/browser/prefs.test.ts` (moved from `tests/`) | browser | real IndexedDB; `beforeEach` drops DB via `indexedDB.deleteDatabase('spectre-pocket')`; `fake-indexeddb` gone |
| `tests/browser/re-enroll.test.ts` (moved from `tests/`) | browser | real IndexedDB + **CDP virtual authenticator** replaces the old `navigator.credentials` mock |

### CDP WebAuthn PRF spike — RESOLVED (no skip/todo needed)
The N2 open question is closed: the CDP virtual authenticator with `hasPrf: true` **works** on the pinned Chromium for both PRF-eval-at-create and resident usernameless `get()`. Details found empirically:
- `import { cdp } from 'vitest/browser'` (in 4.1.10 the runtime path is `@vitest/browser/context`; `vitest/browser` is a virtual module that re-exports it via `@vitest/browser-playwright/context`).
- `WebAuthn.addVirtualAuthenticator` accepts `protocol: 'ctap2'` only — `ctap2_1` is rejected with "The protocol is not valid".
- Options used: `{ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true }`.
- Authenticator is added in `beforeEach` and removed in `afterEach` (per-file BrowserContext; no cross-file leakage anyway).
- `Buffer.from(...).toString('hex')` (Node-only) replaced with a local `toHex(ArrayBuffer)` helper.

### Gotchas fixed during the run
- Node `assert.rejects(fn, /re/)` matches against `String(error)` ("Error: unwrapKey failed" ⇒ `/error/i` matched via the `"Error:"` prefix); vitest `.rejects.toThrow(/re/)` matches `error.message` only. The re-enroll "wrong code" regex was updated to `/unwrap/i` (real message: `unwrapKey failed`).
- `indexedDB.deleteDatabase` is blocked by a just-closed connection (`db.close()` is async), so `resetDb` must **not** reject on `onblocked` — it just waits for `onsuccess` (fires once the old connection finishes closing). Rejecting on `onblocked` produced a flaky `deleteDatabase blocked` failure under parallel full-suite runs.

### Scripts
- `test` → `vitest run`
- `test:unit` → `vitest run --project unit` (4 files, 25 tests)
- `test:browser` → `vitest run --project browser` (2 files, 7 tests)
- `build` unchanged (`tsc -b && vite build`) — still green. Tests are not type-checked by `tsc -b` (only `src/` + `vite.config.ts` are in the tsconfig projects); `vitest.config.ts` and `tests/**` are transpiled by esbuild.

### Follow-ups
- CI: browser job needs `npx playwright install --with-deps chromium` and a `~/.cache/ms-playwright` cache; `npm test` in CI runs headless already.
- N6 (component tests): `App.tsx` tests can now use `@solidjs/testing-library` + `page.elementLocator` under `tests/browser/`; `globals: true` is already in place for auto-cleanup.
- N8 spike can build on the same harness.
- Consider bumping `vite.config.ts`'s `__dirname` → `import.meta.dirname` (pre-existing Vite 8 warning, unrelated to this work).
