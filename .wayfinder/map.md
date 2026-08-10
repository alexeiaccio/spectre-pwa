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
  - Delivery: **host the built app once, install as PWA, then fully offline** (service worker caches everything).

## Decisions so far

<!-- one line per closed ticket -->

- [T1 · Pass-key-to-vault-key unwrap mechanism](tickets/T1-passkey-to-vault-key.md) — Use WebAuthn **PRF extension** (H)MAC → HKDF → AES-GCM vault key; envelope-encrypt DEK under the passkey + a **typed recovery code**. Works offline on Chrome Android ≥130.
- [T3 · Spectre algorithm port scope](tickets/T3-spectre-algorithm-port.md) — Port from **`spectre.app/web` `spectre-algorithm.js`** (android repo is old Java UI). Spectre ⇔ Master Password bit-identical, scrypt N=32768 r=8 p=2 dkLen=64, no HKDF, V0–V3 differ by length encoding. **60/60 official vectors verified**; use `@stablelib/scrypt`; default V3.
- [T4 · Session and lock lifecycle](tickets/T4-session-lock-lifecycle.md) — Two gates: passkey → vault (identity list + site names), passphrase → scrypt master-key once per identity session as non-extractable CryptoKey. Launch = every foregrounding, 2-min grace from `hidden`, full re-auth on lock, enumerate wipe points; JS strings unwipable — hygiene not guarantee.
- [T5 · Offline-first install + SW strategy](tickets/T5-offline-first-pwa.md) — Keep `generateSW`; switch to **`virtual:pwa-register`** (auto reload once on SW update). Re-serve dist/ never touches IndexedDB or passkeys. Bug: manifest references nonexistent `icons.svg` → fix before delivery.

## Not yet specified

- **T2 gap**: vault/DEK envelope schema, recovery-code format, IndexedDB vs OPFS object layout, plaintext-at-rest fields for identity picker. → now ticketable (unblocked: T1 closed).
- T6 visibility across tickets: UI decisions pending research on cancel; could be split into "identity picker" + "result/copy" + "navigation" grilling tickets once T2 schema lands.
- Whether security-answer / login-name purposes are in scope for v1 UI or phase 2.
- Recovery-code UX: when shown, printed, and whether passkey re-enrollment after loss uses it.
- `navigator.storage.persist()` request timing (install vs first unlock).

## Out of scope

- Any server/backend, cloud sync, or network auth. (Offline-only is fixed.)
- Browsing/searching the web from the app.
- Porting the full native Spectre feature set (photo recovery, answer validation) — cipher + vault + unlock only.
- Non-tiny-screen layouts (no desktop-ification of the UI in v1).