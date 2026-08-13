# Spectre Pocket Sync — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/sync/` — map, tickets, research, prototypes live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

Working peer-to-peer vault sync across multiple installs of Spectre Pocket: identity records merge between devices over **iroh** (n0 public relay, WebSocket, end-to-end-encrypted) while the app is open and online. Each device keeps its **own DEK**; synced identity records are decrypted during a merge and **re-encrypted under the receiving device's DEK**; the typed **recovery code** is the universal unwrap (it opens every device's DEK), after which each device enrolls its own passkey. **iroh-docs is the sync layer**; its browser store is memory-only (S1), so the durable vault lives in an **IndexedDB mirror** that iroh re-imports from; pairing via **QR + invitation string**.

## Notes

- Domain: P2P sync (iroh 1.0, Rust→WASM), WebAuthn PRF, per-record AEAD, Vite + SolidJS 2 PWA, small-screen UX.
- Skills sessions should consult: `wayfinder`, `grill-with-docs`, `domain-modeling`, `prototype`, `research`, `code-review`, `vkvideo-testing`.
- Built on the delivered **Spectre Pocket v1** app (see `.wayfinder/map.md`). iroh browser builds are relay-only — browsers cannot hole-punch, so all browser traffic flows via a relay.
- Design decisions locked with the human (2026-08-12):
  - **New effort, new map.** v1's "offline-only / no cloud sync / no server" stands as delivered; this is a fresh destination, not a resumption.
  - Merge unit = **per-identity encrypted records** (each identity: fullName, algorithm, sites[]). Editing two sites of the *same* identity still resolves by whole-record last-writer-wins.
  - **iroh-docs is the sync layer, IndexedDB holds the durable mirror** (S1: the browser docs store is memory-only — no IndexedDB backend exists; we must persist the doc + node SecretKey + author keys ourselves and re-import on launch).
  - Pairing = **QR + invitation string** (both).
  - Onboarding = typed **recovery code** unlocks a remote device's DEK, then enroll the local passkey.
  - **Per-device DEK, re-encrypt on merge** — deliberately *not* a single shared DEK.
  - **n0 public relay**, relay URL kept configurable so a self-hosted relay can be swapped in later.
  - **Foreground-only sync** (app open + online); no background/periodic sync.
- Glossary: `CONTEXT.md` at repo root.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [S1 · iroh-docs in the browser — wasm feasibility](tickets/S1-iroh-docs-wasm.md) — Stack compiles to wasm (iroh + iroh-docs, Feb 2026), but the browser docs store is **memory-only** (no IndexedDB) and there is no wasm NPM package → we must build our own wrapper + an IndexedDB persistence layer; ticket/join primitive, per-key LWW, relay WebSocket E2E, and configurable n0 relay all check out.
- [S2 · Sync record schema and merge rules](tickets/S2-sync-record-schema.md) — Doc keys = **v1 identity uuids**; **one record per identity, ciphertext under the last writer's DEK** (rewrite only on content change — no ping-pong); **one envelope record per device** (device list is implicit); whole-identity LWW **silent**; deletes = key tombstone (identity) / record rewrite (site); device removal = stop syncing, records stay readable via envelope + recovery code.

## Not yet specified

- Relay operations / self-host swap path (config surface known from S1; ops decisions still open).
- Sync status UX (last-synced at, pending changes, relay reachability).
- prefs (theme, autoLockMinutes) — synced or stay local (sharpens in S6).

## Out of scope

- The Spectre **passphrase** — never leaves the device, never syncs (typed per launch).
- Background/periodic/offline-queue sync — foreground + online only.
- WebRTC or direct browser-to-browser connections (impossible in browser sandbox today).
- Sharing anything beyond the vault (no cloud store, no cross-user sync).
