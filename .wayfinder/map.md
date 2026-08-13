# Spectre Pocket — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Tracking conventions: see `README.md` in this tracker. Tickets live in `tickets/`.

## Destination

A deliverable spec + working scaffold for **Spectre Pocket**: an installable, offline-only PWA of the Spectre password cipher, optimized for small portrait screens (Ikko Mind One). It holds **multiple Spectre identities** in a **passkey-unlocked, encrypted local vault**; the Spectre **passphrase is typed on every app launch** and never persisted. Passwords are derived statelessly per site, offline, from the local vault metadata + the typed passphrase.

## Notes

- Domain: security/crypto, WebAuthn, PWA/service workers, small-screen UX.
- Skills sessions should consult: `wayfinder`, `grilling`/`grill-with-docs`, `domain-modeling`, `prototype`, `research`, `code-review`, `vkvideo-testing` (TDD-ish when porting the algorithm), `vite`/Solid 2 gotchas.
- Deliberate stack: Vite + SolidJS **2 (beta)** + Tailwind **v4** + TypeScript + Effect TS **v4 (beta)**. Offline-only: after first install load, zero network.
- Design decisions already made with the human (2026-08-10):
  - Passkey **unlocks an encrypted local vault** (not a login gate).
  - Passphrase prompt appears **on every app launch**; nothing derived from it survives between sessions.
  - "Accounts" = **multiple Spectre identities** (e.g. personal + work), each its own full-name + master secret + saved sites.
  - Delivery: **host the built app once, install as PWA, then fully offline** (service worker caches everything). Add alchemy: deploy the static build via a **Cloudflare Worker** (wrangler) to get an arbitrary-hostname PWA URL without a VPS; worker re-serves `dist/` and never touches IndexedDB or passkeys ([T5 · offline-first](tickets/T5-offline-first-pwa.md)).

## Decisions so far

<!-- one line per closed ticket -->

- [T1 · Pass-key-to-vault-key unwrap mechanism](tickets/T1-passkey-to-vault-key.md) — Use WebAuthn **PRF extension** (H)MAC → HKDF → AES-GCM vault key; envelope-encrypt DEK under the passkey + a **typed recovery code**. Works offline on Chrome Android ≥130.
- [T2 · Vault storage engine and schema](tickets/T2-vault-storage-engine.md) — **IndexedDB**, DB `spectre-pocket` v1, stores `envelope` (key-wrapping header) + `vault` (one AES-GCM blob of the whole tree). DEK random 32B non-extractable, raw wiped after wrapping; KEK = HKDF(secret, random salt) → AES-GCM-256. Nothing user-visible plaintext at rest (identity-picker names dropped from lock screen). Implemented + crypto roundtrip tested.
- [T3 · Spectre algorithm port scope](tickets/T3-spectre-algorithm-port.md) — Port from **`spectre.app/web` `spectre-algorithm.js`** (android repo is old Java UI). Spectre ⇔ Master Password bit-identical, scrypt N=32768 r=8 p=2 dkLen=64, no HKDF, V0–V3 differ by length encoding. **60/60 official vectors verified**; use `@stablelib/scrypt`; default V3. **Implemented**: `src/lib/spectre/{spectre-types,spectre-algorithm,scrypt}.ts`, 7 vector tests pass (`npm test`), V0–V3 incl. multibyte cases.
- [T4 · Session and lock lifecycle](tickets/T4-session-lock-lifecycle.md) — Two gates: passkey → vault (identity list + site names), passphrase → scrypt master-key once per identity session as non-extractable CryptoKey. Launch = every foregrounding, 2-min grace from `hidden`, full re-auth on lock, enumerate wipe points; JS strings unwipable — hygiene not guarantee. **Implemented**: `src/lib/spectre/spectre-session.ts` (SpectreSession, master key as non-extractable HMAC CryptoKey, scrypt once, per-site `sign`), `useIdentitySession.ts` hook, identity gate + tap-to-derive wired in `App.tsx`; `src/lib/lifecycle.ts` grace-period auto-lock (2 min) + freeze/pagehide/beforeunload wipe + 30s clipboard auto-clear. Session vector test passes (`npm test`).
- [T5 · Offline-first install + SW strategy](tickets/T5-offline-first-pwa.md) — Keep `generateSW`; switch to **`virtual:pwa-register`** (auto reload once on SW update). Re-serve dist/ never touches IndexedDB or passkeys. Manifest icon bug already fixed: icons are `icon-192.png`/`icon-512.png` (both present in `public/`), no `icons.svg` reference remains.

## Not yet specified

- [T6 · Tiny-screen UI model](tickets/T6-tiny-screen-ui.md) — **resolved + implemented.** Identity picker after passkey unlock (not on lock screen); navigation ≤2 levels (`identities → sites`), passphrase on the identity screen; reveal-on-tap inline in the row, tap-to-copy with 30s clipboard auto-clear + "copied" flash; all touch targets ≥44px (`tap` utility); dark-only, no animations/images; site quick-add is an inline form. Verified `npm test` + `tsc -b` + `vite build`.
- Whether security-answer / login-name purposes are in scope for v1 UI — **decided**: yes. Site form supports all three purposes + templates; deriving a login/answer uses the purpose-scoped algorithm path (context passed only for `answer`).
- Recovery-code UX — **decided**: the code is user-chosen at setup and typed for recovery unlock; no printing/show-once flow needed. Lost passkey → **re-enrollment** implemented in `vaultImpl.reEnrollPasskey`: requires an active session + re-typed recovery code as proof of ownership, rotates the DEK (fresh passkey PRF, re-wrap under passkey+recovery, re-encrypt blob, old passkey record dropped). Covered by `tests/re-enroll.test.ts` (`fake-indexeddb` + credentials mock), `npm test`.
- `navigator.storage.persist()` request timing — **decided**: request once after the first successful passkey unlock (intent shown, Chrome prompts on the storage origin). Implemented best-effort in `useVault.unlock`.

## Out of scope

- Any server/backend, cloud sync, or network auth. (Offline-only is fixed.)
- Browsing/searching the web from the app.
- Porting the full native Spectre feature set (photo recovery, answer validation) — cipher + vault + unlock only.
- Non-tiny-screen layouts (no desktop-ification of the UI in v1).