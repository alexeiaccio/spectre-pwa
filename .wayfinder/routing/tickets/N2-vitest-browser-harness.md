---
id: N2
title: Vitest browser-mode harness for SolidJS 2
type: research
status: closed
blocked_by: []
assigned: dev
---

## Question

Investigate the minimal **Vitest browser-mode** harness for this repo (Vite 8, SolidJS 2 beta, TypeScript ~6.0, Node 24) and collect the facts N6 (test surface) and N9 (land it) need:

- (a) **Vitest version + `@vitest/browser`**; Playwright provider vs WebdriverIO provider for browser mode; which browsers/installs are required; CI story.
- (b) **solid-testing-library** compatibility with `solid-js` 2 beta, and does it run under `@vitest/browser` (real DOM) or only jsdom?
- (c) **Migration path from the current runner** — `node --experimental-strip-types --test "tests/*.test.ts"` with `fake-indexeddb` (package.json:10). Which existing tests belong in browser mode (IndexedDB, WebCrypto, WebAuthn mocks, component tests) vs node mode (pure Spectre algorithm vectors)? Does `@vitest/browser` give us real IndexedDB/WebCrypto so `fake-indexeddb` can be dropped?
- (d) **Exact package list + `vitest.config` shape**; how `npm test` and `npm run build` coexist; tsconfig impact.
- (e) Anything that blocks browser mode on this stack (Solid 2 beta runtime, vite-plugin-solid, worker).

Write findings to `.wayfinder/routing/research/N2-vitest-browser-harness.md`. Cite versions and sources.

## Resolution

Findings at `research/N2-vitest-browser-harness.md`. No hard blockers.

- **Vitest 4.1.10** (browser mode stable since 4.0; 5.0 is still RC) + **Playwright provider** (`@vitest/browser-playwright` + `playwright@1.62.1` + `npx playwright install chromium`, headless in CI). Two `test.projects` in one `vitest.config.ts`: `unit` (node) + `browser` (chromium). Peers verified: Vite 8.2 ✅, Node 24 ✅.
- **`@solidjs/testing-library@1.0.0-beta.2`** is the Solid-2 build (peer `solid-js >=2.0.0`); officially recommended by Vitest for Solid in browser mode. Requires `globals: true` for auto-cleanup.
- Browser mode gives **real IndexedDB/WebCrypto** (localhost = secure context) — `fake-indexeddb` drops out of browser-project tests. Isolation is per test file (fresh Playwright context); per-test `indexedDB.deleteDatabase('spectre-pocket')` replaces the fresh-`IDBFactory` pattern.
- **WebAuthn PRF**: replace the hand-rolled `navigator.credentials` mock with the **CDP virtual authenticator** (`cdp()` from `vitest/browser`, chromium-only, `hasPrf: true`) — flagged as a spike to verify empirically.
- Migration mapping: 4 pure/WebCrypto files → node project; `prefs` + `re-enroll` → browser project; `App.tsx` (untested) → new browser component tests. All 6 files switch `node:test` → `vitest` imports.
- Feeds N6 (test surface) and N9 (land it). Security: keep browser server host `localhost` in CI (CVE-2026-47429).
