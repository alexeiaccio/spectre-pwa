# Spectre Pocket S6 — Vault-Store Migration to Sync Records — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/s6/` — map, tickets, research, prototypes live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

**Implemented + verified** S6 vault-store migration: the durable mirror moves from the v1 single blob to **per-identity records + per-device envelopes + node identity** (DB `spectre-pocket` v3), **migrated in-place at the first unlock after upgrade**, with the **record bridge** pushing local edits to the sync doc and importing incoming records (LWW by v1 uuid). Live doc delivery stays **behind the experimental flag** (S7: upstream iroh-docs wasm reliability) with a clear banner; the routing seam's `migrating` screen hosts the migration state.

## Notes

- Domain: P2P sync (iroh 1.0 → wasm), IndexedDB mirror, per-record AEAD (per-device DEK), WebAuthn PRF, SolidJS 2 PWA.
- Skills sessions should consult: `wayfinder`, `grill-with-docs`, `domain-modeling`, `prototype`, `research`, `code-review`, `vkvideo-testing`, `vkvideo-pwa`.
- Built on the **routing seam** (`.wayfinder/routing/` — Screen union already reserves `{ view: 'migrating' }` and `{ view: 'join' }`) and the **S5 join flow** (`.wayfinder/sync/` S5 — `src/lib/sync/`: records/adapter/types/pairing, JoinScreen, `useVault.importJoined`).
- Standing decisions already made (do not re-litigate):
  - **S6 resolution** (`.wayfinder/sync/tickets/S6-vault-store-migration.md`): in-place migration at first unlock; mirror in the **same DB bumped to v3** (`records`/`node`/per-device `envelope`; single-blob `vault` dropped); all prefs stay local; migrated DEK = A's DEK; re-enroll = normal S3 two-phase rotation; no legacy path.
  - **S2** (doc key model): identity uuid keys, one record per identity under the last writer's DEK, per-key LWW silent, deletes = tombstone/rewrite. **S3** (per-device DEK): recovery code is vault-wide; rewrite only on content change; fresh random IV per write; no cross-record index.
  - **S7**: browser-to-browser docs sync is **experimental** (upstream iroh-docs wasm); wrapper fixes landed in `crates/spectre-sync`; do not ship live sync as reliable.
  - **PRF-salt + credId** now live on passkey `WrappedDeK`s (resolved with the routing/S5 work, 2026-08-14) — the v3 envelope carries them forward.
  - Current vault code is still the **v1 model** (DB v2: `envelope` + `vault` blob + `prefs`); `crates/spectre-sync` wasm exposes node/doc/ticket/set/get/subscribe, no key-list, no SecretKey export/import.
- The wasm vendor files live in `src/lib/spike/` (copied by `npm run build:wasm`); adapter seam in `src/lib/sync/`.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [M1 · iroh node secret-key persistence feasibility](tickets/M1-node-secret-persistence.md) — **Feasible**: persist 32-byte SecretKey (`to_bytes`/`from_bytes`), restore via `Builder::secret_key`; `Endpoint::secret_key()` exports trivially; DocTicket suffices for doc re-attach; authors optional (minted fresh per spawn). Wasm surface for M9: `start_with_secret_key`/`export_secret_key` (+ optional author import/export), keep `start()` stable.
- [M2 · Upstream iroh-docs browser-sync reliability status](tickets/M2-iroh-sync-upstream-status.md) — **No upstream fix**: no issue exists (repro drafted to file in `n0-computer/iroh-docs`), latest release unchanged, zero browser-runtime sync tests in any upstream CI. Native relay-side participant = official recommendation but must be built as a Rust daemon (no off-the-shelf gateway). Experimental flag stays accurate.
- [M3 · DB v3 schema and store layout](tickets/M3-db-v3-schema.md) — **Pinned**: DB v3 with `records` (uuid → `SyncRecord` = `record`\|`tombstone`, tombstones in now), `envelope` (deviceId → DeviceEnvelope), `node` (secret/doc/author hex), `meta` (deviceId + migrated flag), `prefs` unchanged; `vault` store dropped **after** app-level migration. One canonical `SyncRecord` type shared by mirror + doc wire (v1 doc decode tolerated). Unlock = per-record decrypt under the writer's DEK via envelopes + recovery.
- [M4 · Migration flow — first unlock after upgrade](tickets/M4-migration-flow.md) — **Unlock-first**: boot detects needs-migration (`meta.migrated` unset + v1 `vault` blob present) → new `needs-migration` status → the `migrating` view (union case already reserved). Unlock (passkey w/ prfSalt+credId, or **recovery-only** for pre-fix v2 passkey records) → decrypt → split → re-encrypt per identity under A's DEK → write v3 stores. **Commit = `meta.migrated`**; idempotent re-run; v1 blob survives until commit; failure → retry, never silent loss.
- [M6 · Node mirror + re-import semantics](tickets/M6-node-mirror.md) — **Single persisted vault doc** (`node.doc`), SecretKey on first node use (`node.secret`), **author persisted too** (`node.author`). Re-import on launch: `start_with_secret_key` + doc re-attach when the identities screen is reached (post-migration + post-pairing). Stable node id via persisted SecretKey; mirror loss → re-pair (accepted). Feeds M9 crate surface + M8 bridge.
- [M5 · Record bridge — local edits to the doc, incoming records to the mirror](tickets/M5-record-bridge.md) — **`SyncRecord` gains `writer: deviceId`** (refines M3). Outbound: every save pushes the changed identity (this device's DEK, fresh IV); delete identity → tombstone, delete site → record rewrite; immediate. **Inbound: as-received, lazy decrypt** via the writer's envelope + recovery — re-encrypt only on our own edit (no ping-pong). Pairing = initial write, bridge takes over. Behind the experimental flag.
- [M9 · Crate change — node SecretKey persistence](tickets/M9-crate-node-persistence.md) — **Landed**: `start_with_secret_key(hex)` (refactored `start` into `start_inner(Option<SecretKey>)`, ALPNs + relay-up wait kept), `export_secret_key()`, `export_default_author()`/`import_default_author(hex)`. `npm run build:wasm` green, wasm copied to `src/lib/spike/`, existing API untouched, tsc + 61 unit tests green. Follow-up noted: SecretKey-at-rest encryption for the mirror.
- [M10 · Migration spike — v2 blob → v3 records on real IndexedDB](tickets/M10-migration-spike.md) — **Proven** (`tests/browser/migration-spike.test.ts`, 3/3 green): unwrap A's DEK → decrypt v1 blob → per-identity records under A's DEK (writer deviceId) → v3 stores → commit = `meta.migrated` → clear v1. A's envelope reuses the v2 wraps (S6). **Crash-safe + idempotent**. The v3 `SyncRecord` shape is ready for M7.
- [M7 · Land DB v3 + migration](tickets/M7-land-db-v3-migration.md) — **Landed**: DB v3 + `SyncRecord` v2 (kind/writer), storage helpers, `service.ts` rewritten to per-identity records (setup/unlock/recovery/re-enroll/save/joinImport/migrate), `needs-migration` status + `migrating` view, MigratingScreen. Migration per the M4 recipe. **80/80 tests + build green**, real-browser smoke: migrating view renders against a genuine v2 vault. Known limit → M8: foreign-writer records need the lazy-decrypt path; wrong-code message is raw ("unwrapKey failed").

## Not yet specified

- **Sync status UX** (last-synced at, pending changes, relay reachability) — needs live sync reliability to be meaningful; wait on M2.
- **Existing-vault adopt-code join** (S5 follow-up) — needs the record bridge (M5/M8) before it can merge.
- **Invitation deep links / Web Share target** and **QR generation** for invitations.
- **Native (Node/CLI) relay-side participant** as a fallback if browser sync stays unreliable (S7 option) — a big fork; revisit after M2.

## Out of scope

- The Spectre **passphrase** — never leaves the device, never syncs.
- **Background/periodic sync** — foreground + online only.
- **WebRTC / direct browser-to-browser** connections.
- **Cross-user sharing** — anything beyond the user's own devices.
- **Fixing the upstream iroh-docs browser-sync engine** — tracked via M2, not fixable in this repo.
