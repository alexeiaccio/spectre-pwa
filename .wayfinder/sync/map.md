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
- **Routing seam ready (2026-08-14)** — the routing effort (`.wayfinder/routing/`) landed its spec: `spec-screen-module.md` §9 contracts S5's join flow (**`{ view: 'join' }` union case, internal steps, no per-step URLs**), the pairing section (**inline on the identities screen**, no case), and S6's migration (**`{ view: 'migrating' }` transient case**). The seam never imports iroh/envelope/DEK — Sync ships flow logic behind screen components. **S5 implementation is unblocked**; the harness (Vitest browser mode) and Oxc lint/format are landed too.
- **S5 implemented (2026-08-14)** — fresh-join flow + pairing section landed on the seam (`src/lib/sync/`: records/adapter/types/pairing, `JoinScreen`, join links, `useVault.importJoined`; 67 tests green). Follow-ups tracked in the S5 ticket: existing-vault adopt-code join, QR, PRF-salt persistence, node-id persistence, A-side live writes, and live sync stays experimental (S7).
- Glossary: `CONTEXT.md` at repo root.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [S1 · iroh-docs in the browser — wasm feasibility](tickets/S1-iroh-docs-wasm.md) — Stack compiles to wasm (iroh + iroh-docs, Feb 2026), but the browser docs store is **memory-only** (no IndexedDB) and there is no wasm NPM package → we must build our own wrapper + an IndexedDB persistence layer; ticket/join primitive, per-key LWW, relay WebSocket E2E, and configurable n0 relay all check out.
- [S2 · Sync record schema and merge rules](tickets/S2-sync-record-schema.md) — Doc keys = **v1 identity uuids**; **one record per identity, ciphertext under the last writer's DEK** (rewrite only on content change — no ping-pong); **one envelope record per device** (device list is implicit); whole-identity LWW **silent**; deletes = key tombstone (identity) / record rewrite (site); device removal = stop syncing, records stay readable via envelope + recovery code.
- [S3 · Per-device DEK re-encryption and unlock protocol](tickets/S3-per-device-dek-reencrypt.md) — Recovery code is **vault-wide**; read/merge = unwrap writer's DEK via code, decrypt, re-encrypt under local DEK only on content change; **random IV per write**; no cross-record index (each record atomic, partial sync is fine); **two-phase DEK rotation** (both wraps present → re-encrypt own records → drop old wrap), rotates **this device's** records only; master secret moves between devices encrypted only; Write ticket can clobber records (no revocation) — accepted.
- [S5 · Pairing and first-run UX on tiny screens](tickets/S5-pairing-ux.md) — First-run: **Create vault primary + "join it" link** (no chooser); **existing vaults can join too** — B adopts A's code (re-wraps DEK-B under A's code, old code dies); identities merge **by v1 uuid, LWW resolves**; **code prompted after sync, verified** by unwrapping host envelope, then passkey enrollment; pairing lives in a **"Sync with another device" identity-picker section** (QR = DocTicket + copy-string fallback); trust = Write-ticket clobber, accepted.
- [S6 · Vault-store migration to iroh-docs](tickets/S6-vault-store-migration.md) — **In-place migration at first unlock after upgrade** (blob → per-identity records under A's DEK); durable mirror in the **same DB bumped to v3** (`records`/`node`/per-device `envelope`; single-blob `vault` dropped); **all prefs stay local**; migrated DEK = A's DEK, re-enroll = normal S3 two-phase rotation, no legacy path.

## Not yet specified

- Sync status UX (last-synced at, pending changes, relay reachability) — depends on the S7 upstream question (browser sync reliability) before it's sharp enough to build. Tracked for revival under **Sync-bg** (`.wayfinder/sync-bg/map.md`), which owns background/periodic sync + the pending-changes signal this UX needs.

## Decisions so far (2026-08-14)

- **Relay ops / self-host swap — decided: keep the n0 public relay.** No self-host path planned; `RelayMode::Custom` remains as the config surface (S1) if it's ever needed, but it is not a roadmap item.

## Out of scope

- The Spectre **passphrase** — REVISED (2026-08-15): now stored as `Identity.passphrase` inside the DEK-encrypted record (wrap-under-DEK, so passkey unlock auto-unlocks identities). It therefore travels inside synced records; the recovery code now also yields every derived password. Old "never syncs" stance superseded by human decision.
- **Background/periodic sync** — foreground + online only. Revived as its own effort: **Sync-bg** (`.wayfinder/sync-bg/map.md`).
- WebRTC or direct browser-to-browser connections (impossible in browser sandbox today).
- Sharing anything beyond the vault (no cloud store, no cross-user sync).
