---
id: T5
title: Offline-first install and service-worker strategy
type: research
status: closed
blocked_by: []
assigned:
---

## Question

Verified delivery path: host the built `dist/` once, add-to-home-screen, then run offline forever. Pin the service-worker details so "offline-only" is real:

- Precache strategy (vite-plugin-pwa `generateSW` vs `injectManifest`); all hashed assets + `/index.html` as navigation fallback — confirm no runtime network for any path after first load.
- WebAuthn/PRF policy in **secure-context-required**: does a served PWA (https) preserve passkey creds across reinstall/updates? Storage origin stability.
- Update flow: how does a new version reach the phone without breaking offline (sw update on next online launch)? Account for "host once" — updates require re-serving.
- What must ship in the app shell so the first screen (identity picker) works with zero network.

## Resolution

Closed 2026-08-10 · full report: `.wayfinder/research/T5-offline-first-pwa.md`.

- **Keep `generateSW`** (content-hashed assets + single HTML entry = generateSW case; injectManifest adds nothing).
- **Change: import `virtual:pwa-register`** (registerSW.js injected today does NOT reload — re-host shows one launch behind; virtual:pwa-register reloads once on fresh SW activation).
- Offline guarantee is inherent: Workbox precache install is atomic; hashed assets immutable; navigateFallback serves one consistent version.
- **Persistence verified:** re-serving dist/ + SW cache churn never touch IndexedDB (vault) or platform-authenticator passkeys. Real wipe risks: manual clear-site-data, iOS-PWA uninstall, incognito, storage-pressure eviction (mitigate with `navigator.storage.persist()`).
- Shell needs: index.html + hashed JS/CSS + manifest.webmanifest + icons + sw.js + workbox + registerSW.js.
- **Bug found:** manifest references `icons.svg` (192×192) which doesn't exist in public/ → install icon 404s. Fix/remove before delivery.