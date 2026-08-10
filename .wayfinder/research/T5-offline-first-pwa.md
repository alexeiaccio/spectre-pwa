# T5 — Pin the Service Worker / Caching so "offline-only after first load" is guaranteed and updates still reach the phone

**Date:** 2026-08-10 · **Status:** Decision-ready · **Repo:** `/Users/a.tukachev/github/spectre-pwa` (Vite 8, SolidJS 2, vite-plugin-pwa **1.3.0**, workbox-build **7.4.1**, current strategy `generateSW`, `registerType: 'autoUpdate'`)

---

## Summary of the answer

1. **Strategy — keep `generateSW`.** All build output is content-hashed by the bundler and there is exactly one entry (`index.html`). Workbox's own guidance is: use `generateSW` when you "want to precache files" and have "simple runtime caching needs" — injectManifest exists only for custom SW logic (Web Push, hand-written routes). This app needs none of that. generateSW is strictly less code to maintain and harder to break.
2. **Offline guarantee is inherent.** Workbox precaching installs are *all-or-nothing* (install failure discards the new SW), and `navigateFallback` + hashed-asset URL immutability make every offline navigation serve one internally-consistent shell.
3. **Update flow — `autoUpdate` is correct for this product, with one change:** import `virtual:pwa-register` so a freshly-activated SW reloads the tab once (currently the injected `registerSW.js` does *not* reload, so the very first launch after a re-host shows the previous version). Mixed-version serving cannot happen for page loads; the only fined edge is an already-open tab (handle via reload and no un-precached chunks).
4. **Persistence — confirmed, with caveats.** Re-serving `dist/` and SW cache churn do **not** touch IndexedDB/vault or WebAuthn/passkey credentials. Vault lives in origin IndexedDB; passkeys live in the *platform authenticator* (Secure Enclave / Keychain / Keystore), not web storage. Real exceptions: manual "Clear site data", storage-pressure eviction (mitigated by installed-PWA persistent storage), Safari 7-day cap for non-installed web apps, incognito, and iOS PWA container deletion on uninstall.
5. **Shell needs:** `index.html` + the (hashed) JS bundle + hashed CSS + `manifest.webmanifest` + icons + `sw.js` + `workbox-*.js` + `registerSW.js`. The identity picker itself renders zero-network because it only reads IndexedDB + `navigator.credentials`.

**One bug found while auditing:** the manifest references `icons.svg` (192×192) but that file does not exist in `public/` or `dist/` → the add-to-home-screen icon will 404. Fix before delivery (below).

---

## 1. `generateSW` vs `injectManifest` — which fits this SPA

### Decision: `generateSW` (keep it)

`workbox-build` (via Chrome docs, *Which Mode to Use*):

> Use **`generateSW`** when: you want to precache files; you have simple runtime caching needs. Use **`injectManifest`** when: you want more control; you need custom routing/strategies; you want to use your SW with other platform features (Web Push).

This app is precisely the generateSW case:
- Vite emits **content-hashed, immutable** assets (`assets/index-*.js`, `index-*.css`) and exactly one HTML entry.
- `dist/sw.js` (1.2 KB) + `dist/workbox-9c191d2f.js` (15 KB) are already produced correctly by generateSW and precache **7 entries** with `revision: null` on hashed assets and content-hash revisions on `index.html`/`registerSW.js`/`favicon.svg`/`manifest.webmanifest`.
- No push, no custom fetch logic, no runtime caching beyond precache → injectManifest would only add a second build, a hand-written SW file, and more failure surface for zero benefit.

### What the current config already does right (verified in 1.3.0 source + emitted `sw.js`)

`vite-plugin-pwa` seeds these into the `generateSW` options, and explicitly setting them (as this repo does) is harmless:

| Option | Effect | Set in plugin default? | Repo sets? |
|---|---|---|---|
| `navigateFallback: 'index.html'` | All navigation requests not precached are served the precached `index.html` (SPA app-shell) | **Yes** (1.3.0 `defaultWorkbox`) | Yes |
| `cleanupOutdatedCaches: true` | New SW deletes precache caches from older, incompatible SW generations on activate | **Yes** | Yes |
| `dontCacheBustURLsMatching: /^assets\//` | Hashed build assets are considered immutable → precached with `revision:null`, never re-fetched → the exact band-efficiency + offline-safety property you want | **Yes** | No (inherits default — works, proven by emitted `revision:null`) |

`globPatterns: ['**/*.{js,css,html,svg,png,ico}']` covers everything Vite emits into `dist/` (`assets/*.js`, `assets/*.css`, `index.html`, `favicon.svg`). The plugin *additionally* forces `manifest.webmanifest` and the manifest icons / `includeAssets` into the precache, and automatically excludes `sw.js` and the `workbox-*.js` runtime from the precache list (they are the SW itself).

### Recommended exact config (drop-in)

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],            // NB: icons.svg below does NOT exist — fix
      manifest: {
        name: 'Spectre Pocket',
        short_name: 'Spectre',
        description: 'Offline-only password cipher. Remember one secret, math does the rest.',
        theme_color: '#3E8989',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],                                        // drop icons.svg (missing) or ship a real 192x192
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        globIgnores: ['**/sw.js', '**/workbox-*.js'],   // belt & braces; plugin excludes these anyway
        cleanupOutdatedCaches: true,                    // twice-safe (plugin turns it on, explicit again is harmless)
      },
    }),
  ],
})
```

Notes:
- If the host places the app at a URL sub-path, set Vite `base` and manifest `start_url` accordingly; the plugin derives `scope` from `base` (default `/`). Root hosting needs nothing.
- `maximumFileSizeToCacheInBytes` defaults to 2 MiB; current bundles are ~25 KB — fine.
- **`icons.svg` bug:** `public/` contains only `favicon.svg`, but `manifest.webmanifest` (emitted to `dist/`) declares `"src": "icons.svg", "sizes": "192x192"`. It is neither in the precache nor on the host → install icon 404. Either add a real `public/icons.svg` (192×192, `purpose: any maskable`) or remove it from both `manifest.icons` and `includeAssets`.

---

## 2. Confirmation: after first successful load, reloads/launches (even offline) serve the precached shell

Mechanics (source: web.dev *The service worker lifecycle*):

- **First visit:** the page loads normally; `registerSW.js` (injected in `<head>`) registers `/sw.js` on `window load`. The SW downloads, `install` runs, and the precache (7 entries) is populated. `clientsClaim()` means it takes control of the page once active. The first load is network-dependent — this is the "install moment", the *last* network dependency this app ever has.
- **Every subsequent load:** if online, the browser checks `/sw.js` for a byte-difference on each in-scope navigation; if offline, the fetch of `sw.js` fails, the existing SW (byte-identical to what the browser has) stays, and **all requests are served from its precache.**
- **Hashed assets + `navigateFallback` interaction:** precache holds `index.html` with a content-hash `revision` and `assets/index-*.js/css` with `revision: null`. `navigateFallback` pipes *any* navigation request (`/`, refresh, back/forward, a future deep link) to the same precached `index.html` through a `NavigationRoute` (`createHandlerBoundToURL('/index.html')`). Because hashed URLs are immutable, an offline reload can never ask the network for a stale or missing chunk — every navigation gets `index.html` + asset files whose URLs are guaranteed present in the same precache generation. That pair is what makes the "offline forever" claim true, not either piece alone.

Workbox precaching is also **atomic**: `precacheAndRoute` resolves `install` only when *every* manifest entry is cached; an install that fails is discarded and the old SW keeps running (web.dev lifecycle, "your service worker considered updated if byte-different… rejects during install → new worker thrown away, current one remains"). A half-filled cache never becomes active.

---

## 3. Update flow — the re-host scenario, and how to avoid mixed versions

### What actually happens when the human re-hosts a NEW `dist/` and the user opens the app online

1. User launches the app; navigation to `/` → **old** SW handles it (old SW is still active) and serves the **old** precached `index.html` + **old** hashed assets. Internally consistent.
2. Browser also byte-compares `/sw.js`: the new build's `sw.js` differs (precache list + fingerprint changed) → **new SW installs**: it writes the *entire* new precache (new `index.html` with new revision, new hashed assets, new `manifest.webmanifest`) into a fresh workbox-precache cache.
3. `registerType: 'autoUpdate'` forces `skipWaiting: true` + `clientsClaim: true` (verified in 1.3.0 `index.js`: `workbox.skipWaiting = true; workbox.clientsClaim = true`), so the new SW immediately activates and `cleanupOutdatedCaches` drops the old precache.
4. Next navigation (or the controlled reload) goes through the **new** SW → new `index.html` + new assets.

**Mixed-version answer:** an old SW **never serves a new `index.html`** and a new SW **never serves an old hashed asset** for page loads. Both the HTML and the assets move between precache generations *atomically*, and `navigateFallback` guarantees a navigation is answered by exactly one SW's precache. New-HTML-referencing-old-assets therefore cannot occur. Even code-split chunks land in `dist/assets/*.js`, so they are in the same atomic precache generation.

**The one real residual risk** is an already-open *long-lived tab* right after `clientsClaim`: the old page keeps running old JS, and if that page performs a *new* fetch that the new SW no longer has (a lazy chunk not in the new precache, fetched while offline), it fails. Mitigations (all cheap for this app):
- Keep the shell in a **single eagerly-loaded bundle** (current build is already one JS + one CSS) — then the running page already holds every module in memory.
- Ensure code-split chunks remain under `assets/` so they are precached in every generation.
- Use the reload strategy below so the old page is short-lived by design.

### `autoUpdate` vs `prompt`

| | `autoUpdate` | `prompt` |
|---|---|---|
| New SW | activates immediately (`skipWaiting`+`clientsClaim`), reload once | waits; you show a UI and call `messageSkipWaiting()` → reload |
| Fit here | ✔ This product is a vault/passphrase UI with **no forms to lose**; an auto-reload just re-shows identity picker / re-unlocks via passkey. Vault writes are atomic IndexedDB transactions — a reload mid-write either commits or aborts cleanly, no corruption. | Adds an update-prompt UI to an app whose entire point is silent offline permanence. Only needed if you fear the reload landing mid-passphrase-entry. |

**Recommendation: `autoUpdate`, plus one code change.** As shipped today (`injectRegister` default `auto`, no virtual import), the plugin emits a *plain* `registerSW.js` that has **no reload logic** (verified in 1.3.0 `generateSimpleSWRegister`) — so the first online launch after a re-host serves the old version, and only the *second* launch shows the new one. Fix by importing the virtual module in `src/index.tsx`:

```ts
import { registerSW } from 'virtual:pwa-register'

registerSW({
  onOfflineReady() {
    // optional: hide/never show "ready offline" toast — app is offline-first anyway
  },
  onNeedReload() {
    // default (if omitted) is window.location.reload()
    // For extra safety you can gate it: only reload when app is LOCKED,
    // e.g. if (isLocked()) window.location.reload() else defer.
  },
})
```

With the virtual module present, the plugin switches to `workbox-window` registration: on the new SW's `activated` (`isUpdate`), it calls `onNeedReload` → reload once → the user lands on the new version on that very first online launch. No user interaction required, and the reload happens once, immediately after install, not intermittently. (Tip: `injectRegister` goes to `null` automatically when the module is imported — nothing else to configure.)

If you want zero-JS-loaded-before-update and prefer "one launch behind" over an automatic reload, you can *also* keep the plain injected `registerSW.js` — offline permanence is unaffected; only update latency differs. The virtual-module version is strictly better for this product.

**To never reintroduce mixed versions**, the whole strategy is already the correct one — Workbox handles `index.html`'s version by content-hash *revision* (no need to rename the HTML file). Do NOT adopt "versioned SW file names" (`sw-v2.js`): web.dev's lifecycle article explicitly warns this puts you in a position "where you need to update your service worker in order to update your service worker" because the old SW keeps serving cached old `index.html`.

---

## 4. Persistence check — re-serving `dist/` / cache churn vs WebAuthn + IndexedDB

### Verdict: **cache churn and re-deploying `dist/` do NOT touch the vault or passkeys.** Confirmed, with the exceptions listed below.

- **Vault (vault data / encrypted records / identity names) lives in IndexedDB.** That is *origin storage*, a different container from Cache Storage. `cleanupOutdatedCaches` deletes only Workbox precache caches (namespaced `workbox-precache-*`) for this origin; it has no API path to IndexedDB. Re-serving a new `dist/` writes nothing outside Cache Storage. A freshly-activated SW merely opens a *new* precache cache name — old precache caches are deleted by design, IndexedDB is untouched.
- **WebAuthn/passkey credentials are not in web storage at all.** The private key is held by the **platform authenticator** (macOS Secure Enclave / iCloud Keychain, Android Keystore, Windows Hello). Websites store only the *public* key server-side; here the app needs only the authenticator discovery (`navigator.credentials`) which works offline. Passkeys are keyed per RP ID (`origin`) but their storage medium is outside Cache/IndexedDB, so SW updates, cache cleanup, and site-data clearing for the origin do **not** delete them (Chrome: deleted only by explicitly clearing *"Passwords and other sign-in data"* / `chrome://settings/passkeys`).

### Real exceptions that CAN wipe the vault (nothing in your delivery can prevent these — document them to the human):

1. **Manual "Clear site data" / "Clear browsing data".** Target: `chrome://settings/content/siteDetails`, `three-dots ▸ Clear Browsing Data`, or mobile equivalents — deleted *all* origin storage for the site: IndexedDB (the vault), Cache Storage, cookies, and SW registrations. The passkeys survive, but the vault is gone. **Mitigation only:** vault export/backup UX.
2. **Storage-pressure eviction.** By default IndexedDB + Cache Storage are *"best effort"*; under low disk space Chromium/Firefox evict the LRU origin's *entire* site data. **Mitigation (real):** installed PWAs are auto-eligible for persistent storage — Chrome silently grants `navigator.storage.persist()` to sites that "are installed" (heuristic), which protects Cache, IndexedDB, SW, cookies, etc. from eviction; it is *not* protection against #1. Firefox prompts the user. Recommend calling `navigator.storage.persist()` once at first vault save (user-gesture wrapped) and logging `navigator.storage.persisted()`.
3. **Safari/iOS 7-day ITP cap — only for non-installed web apps.** Safari ≥13.1 evicts all script-writable storage (IndexedDB, Cache, SW registration) after 7 days of non-use for sites **not** added to the home screen; **installed PWAs are exempt** (web.dev *Storage for the web*). With the delivery model (add-to-home-screen) this does not apply — but a user who merely "visits" without installing would lose the vault. Make installation part of onboarding.
4. **Incognito/private mode.** All origin storage is destroyed when the private session ends; passkey facets may behave differently. App should refuse to run as a vault in incognito (detect via `navigator.storage` decline or just document it).
5. **iOS home-screen web-app storage container — deleted on uninstall.** An installed iOS PWA gets its own isolated storage container; removing the app removes the container **including the vault**. Uninstall is destructive; the human/UX must state this.

No other triggers exist: re-serving `dist/` byte-identical or changed, serving different hashed assets, `cleanupOutdatedCaches`, cache-name changes, or a fresh SW claiming control never fire a "clear site data" for the origin.

---

## 5. What the app shell must contain for the identity-picker first screen to render with zero network

The identity picker reads **identity display names (`full name` of each Spectre identity)** from the encrypted vault's *metadata* (IndexedDB) and offers passkey unlock via `navigator.credentials` — all purely local. For it to render with no network, this exact set must be in the precache (it already is after step 1 & 2, given the config above):

| File | Role | Precached? |
|---|---|---|
| `/` (any navigation) → precached `index.html` via `navigateFallback` | HTML shell, `<div id="root">`, injected `<script src="/registerSW.js">` + `<link rel="manifest">` + favicon link | yes (revision-hashed) |
| `assets/index-*.js` | Entire app incl. identity-picker logic, IndexedDB access, WebAuthn calls | yes (`revision:null`) |
| `assets/index-*.css` | Layout/theme Tailwind sheet the picker needs | yes (`revision:null`) |
| `manifest.webmanifest` | installability + start_url/scope; browser fetches it at A2HS time | yes (plugin forces it) |
| `favicon.svg` (+ any real app icon) | install badge | yes |
| `sw.js` + `workbox-*.js` | the runtime that makes all of the above offline-serving | the SW itself (excluded from precache, correct) |
| `registerSW.js` | tiny registration stub referenced by `index.html` | yes (verified in current precache) |

Offline-render rules for the picker:
- **Fonts/icons: no network origins.** No Google Fonts / icon-font CDNs — a network font `<link>` silently fails offline. Use system font stack or bundle `@fontsource` files (they land in `assets/`, i.e. precached). Current project uses Tailwind + no remote resources — safe.
- **No external calls at boot.** No analytics/beacons/tracking `<script>`, no remote config, no CDN enum-loading until the picker has rendered. (Any future `fetch`/`navigator.sendBeacon` must be inside a try/catch — it will throw offline.)
- **First-run state:** the "no identities yet → create your first identity" screen must also be fully local (it is: creation = IDB write + passkey registration).
- **DPI/a11y:** picker works inside a `display: standalone` viewport with `viewport-fit=cover`; safe-area insets handled in CSS, no JS dependency.

---

## Recommendation (decision block)

- **Strategy:** `generateSW` (already in use — keep). injectManifest adds risk, not value, for a single-hash-shell SPA.
- **Config:** as in §1 (drop-in). Fix the `icons.svg` bug before delivery.
- **registerType:** `autoUpdate` + import `virtual:pwa-register` with `onNeedReload` (reload-once) and optional `onOfflineReady`. This is the only code change requested.
- **Versioning contract (do not break):** never rename/version `sw.js`; keep index.html + assets served from the same paths; hashed assets get `Cache-Control: public, max-age=31536000, immutable`; `index.html` and `sw.js` get `Cache-Control: no-cache` on the host. This ordering is what keeps the SW update check honest and the precache generations atomic.
- **Persistence:** confirmed independent (§4). Must-document caveats: manual clear-site-data, uninstall-of-iOS-PWA, incognito; can reduce one risk vector via `navigator.storage.persist()`.

## Update process — written for the human

1. **Edit code → run `npm run build`.** Vite re-hashes changed files; generateSW re-fingerprints `index.html`, `manifest.webmanifest`, `registerSW.js` and rewrites `sw.js`.
2. **Sanity-check `dist/` before publishing:** new `sw.js` present (its size/binary will differ), `assets/index-*.js|css` present, `manifest.webmanifest` + `favicon.svg` present, and the `workbox-*.js` runtime file (hash changes with the tool) present. Confirm the precache list in `dist/sw.js` references them.
3. **Publish all of `dist/`** to the same host path as before — same directory layout, same `/sw.js` URL, same `index.html` path. Do **not** re-host only some files: a partial deploy either fails the new SW install (old SW keeps running — safe) or, if index.html were swapped without its assets, would break the next online navigation. Keep file-count small enough that a full `dist/` copy is trivial (7 files today).
4. **No action needed per user.** Next time the phone opens the app while online, the browser byte-checks `/sw.js` on navigation, installs the new precache atomically, `skipWaiting`+`clientsClaim` activate it, `onNeedReload` reloads once, and the new version is live. All subsequent offline launches use the new precache. Offline users who never open the app online simply keep the last installed version indefinitely — they are never pushed a bad update, because a new SW never activates with a partial cache.
5. **Verify once per delivery:** open the app online → DevTools ▸ Application ▸ Service Workers shows the new script "activated"; Application ▸ Cache ▸ Cache Storage shows the new `workbox-precache-v2-*` and no old entry (cleanup ran). Then switch to airplane mode, relaunch from home screen, and confirm the identity picker renders.

## Cited sources

- vite-plugin-pwa — Automatic reload (`registerType:'autoUpdate'` forces `clientsClaim`+`skipWaiting`; cleanup/offline-ready): https://vite-pwa-org.netlify.app/guide/auto-update.html
- vite-plugin-pwa — Advanced (injectManifest) strategy: https://vite-pwa-org.netlify.app/guide/inject-manifest.html
- vite-plugin-pwa — Prompt for new content / registerType options (defaults, `generateSW` ignore): https://vite-pwa-org.netlify.app/guide/prompt-for-update.html
- vite-plugin-pwa 1.3.0 source (verified locally, `node_modules/vite-plugin-pwa/dist/index.js` + `dist/client/build/register.js`): `defaultWorkbox` seeds `navigateFallback:'index.html'`+`cleanupOutdatedCaches:true`+`dontCacheBustURLsMatching:^assets/`; autoUpdate sets `skipWaiting`/`clientsClaim`; script-injection `generateSimpleSWRegister` has no reload logic; virtual module switches to `workbox-window` with `onNeedReload`.
- workbox-build docs (generateSW vs injectManifest; `navigateFallback`, `globPatterns` default, `dontCacheBustURLsMatching`, `skipWaiting` message-listener behavior): https://developer.chrome.com/docs/workbox/modules/workbox-build/
- web.dev — The service worker lifecycle (update triggers on navigation, byte-diff check, install atomicity/rollback, waiting/skipWaiting for consistency, "only one version at once", do-not-version-SW-URL): https://web.dev/articles/service-worker-lifecycle
- web.dev — Storage for the web (Cache API & IndexedDB are origin storage; eviction LRU under disk pressure; Safari 7-day cap vs installed-PWA exemption; quota/QuotaExceededError): https://web.dev/articles/storage-for-the-web
- web.dev — Persistent storage (best-effort vs persistent; Chrome silently grants to "installed" sites; protects Cache, IndexedDB, SW, cookies from eviction only): https://web.dev/articles/persistent-storage
- WebAuthn/passkey storage is in the platform authenticator, not web storage; removed via browser "passwords/sign-in data" settings, not site-data clearing — Stack Overflow (agl/Tim on WebAuthn platform authenticator) and Microsoft WebAuthNDeletePlatformCredential docs; Chrome passkeys settings `chrome://settings/passkeys`.