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

- none yet

## Not yet specified

- Whether the vault stores per-identity *full name* as plaintext (needed for the identity picker before unlock) vs encrypted entirely.
- Whether "locked" state should erase the vault key and derived material from memory (JS, so assume yes).
- Which Spectre algorithm versions to support (V0–V3) — likely all four selectable, port from reference C.
- Whether security-answer / login-name purposes are in scope for v1 UI or phase 2.
- If passkey PRF (WebAuthn L3) is unsupported on the target device → fallback key-wrapping mechanism for the vault.

## Out of scope

- Any server/backend, cloud sync, or network auth. (Offline-only is fixed.)
- Browsing/searching the web from the app.
- Porting the full native Spectre feature set (photo recovery, answer validation) — cipher + vault + unlock only.
- Non-tiny-screen layouts (no desktop-ification of the UI in v1).