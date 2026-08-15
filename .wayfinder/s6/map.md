# Spectre Pocket S6 — Vault-Store Migration to Sync Records — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/s6/` — map, tickets, research, prototypes live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

**Implemented + verified** S6 vault-store migration to sync records: the durable mirror is **per-identity records + per-device envelopes + node identity** (DB `spectre-pocket` v3), with the **record bridge** pushing local edits to the sync doc and importing incoming records (LWW by v1 uuid). Live doc delivery stays **behind the experimental flag** (S7: upstream iroh-docs wasm reliability) with a clear banner. **No migration path — the app starts fresh at v3** (no users; the v1/v2 blob format is dropped entirely).

## Notes

- Domain: P2P sync (iroh 1.0 → wasm), IndexedDB mirror, per-record AEAD (per-device DEK), WebAuthn PRF, SolidJS 2 PWA.
- Skills sessions should consult: `wayfinder`, `grill-with-docs`, `domain-modeling`, `prototype`, `research`, `code-review`, `vkvideo-testing`, `vkvideo-pwa`.
- Built on the **routing seam** (`.wayfinder/routing/` — Screen union reserves `{ view: 'join' }`) and the **S5 join flow** (`.wayfinder/sync/` S5 — `src/lib/sync/`: records/adapter/types/pairing, JoinScreen, `useVault.importJoined`).
- Standing decisions already made (do not re-litigate):
  - **S6 resolution** (`.wayfinder/sync/tickets/S6-vault-store-migration.md`): mirror in the **same DB bumped to v3** (`records`/`node`/per-device `envelope`; single-blob `vault` dropped); all prefs stay local; re-enroll = normal S3 two-phase rotation. **The in-place migration part is superseded — no users (2026-08-15).**
  - **S2** (doc key model): identity uuid keys, one record per identity under the last writer's DEK, per-key LWW silent, deletes = tombstone/rewrite. **S3** (per-device DEK): recovery code is vault-wide; rewrite only on content change; fresh random IV per write; no cross-record index.
  - **S7**: browser-to-browser docs sync is **experimental** (upstream iroh-docs wasm); wrapper fixes landed in `crates/spectre-sync`; do not ship live sync as reliable.
  - **PRF-salt + credId** live on passkey `WrappedDeK`s (resolved 2026-08-14) — the v3 envelope carries them.
  - **DB v3 + per-identity-record vault landed** (M7, 2026-08-15): `records`/`envelope`(per-device)/`node`/`meta`/`prefs`; fresh installs only.
- The wasm vendor files live in `src/lib/spike/` (copied by `npm run build:wasm`); adapter seam in `src/lib/sync/`.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [M1 · iroh node secret-key persistence feasibility](tickets/M1-node-secret-persistence.md) — **Feasible**: persist 32-byte SecretKey (`to_bytes`/`from_bytes`), restore via `Builder::secret_key`; `Endpoint::secret_key()` exports trivially; DocTicket suffices for doc re-attach; authors optional (minted fresh per spawn). Wasm surface for M9: `start_with_secret_key`/`export_secret_key` (+ optional author import/export), keep `start()` stable.
- [M2 · Upstream iroh-docs browser-sync reliability status](tickets/M2-iroh-sync-upstream-status.md) — **No upstream fix**: no issue exists (repro drafted to file in `n0-computer/iroh-docs`), latest release unchanged, zero browser-runtime sync tests in any upstream CI. Native relay-side participant = official recommendation but must be built as a Rust daemon (no off-the-shelf gateway). Experimental flag stays accurate.
- [M3 · DB v3 schema and store layout](tickets/M3-db-v3-schema.md) — **Pinned**: DB v3 with `records` (uuid → `SyncRecord` = `record`\|`tombstone`, tombstones in now), `envelope` (deviceId → DeviceEnvelope), `node` (secret/doc/author hex), `meta` (deviceId), `prefs` unchanged. One canonical `SyncRecord` type shared by mirror + doc wire (v1 doc decode tolerated). Unlock = per-record decrypt under the writer's DEK via envelopes + recovery.
- [M4 · Migration flow — first unlock after upgrade](tickets/M4-migration-flow.md) — **SUPERSEDED (2026-08-15): dropped — no users.** The v1/v2 blob format is gone; the app starts fresh at v3. Its migration design is now out of scope.
- [M6 · Node mirror + re-import semantics](tickets/M6-node-mirror.md) — **Single persisted vault doc** (`node.doc`), SecretKey on first node use (`node.secret`), **author persisted too** (`node.author`). Re-import on launch: `start_with_secret_key` + doc re-attach when the identities screen is reached (post-pairing). Stable node id via persisted SecretKey; mirror loss → re-pair (accepted). Feeds M9 crate surface + M8 bridge.
- [M5 · Record bridge — local edits to the doc, incoming records to the mirror](tickets/M5-record-bridge.md) — **`SyncRecord` gains `writer: deviceId`** (refines M3). Outbound: every save pushes the changed identity (this device's DEK, fresh IV); delete identity → tombstone, delete site → record rewrite; immediate. **Inbound: as-received, lazy decrypt** via the writer's envelope + recovery — re-encrypt only on our own edit (no ping-pong). Pairing = initial write, bridge takes over. Behind the experimental flag.
- [M9 · Crate change — node SecretKey persistence](tickets/M9-crate-node-persistence.md) — **Landed**: `start_with_secret_key(hex)` (refactored `start` into `start_inner(Option<SecretKey>)`, ALPNs + relay-up wait kept), `export_secret_key()`, `export_default_author()`/`import_default_author(hex)`. `npm run build:wasm` green, wasm copied to `src/lib/spike/`, existing API untouched, tsc + unit tests green. Follow-up noted: SecretKey-at-rest encryption for the mirror.
- [M10 · Migration spike — v2 blob → v3 records on real IndexedDB](tickets/M10-migration-spike.md) — **SUPERSEDED (2026-08-15): dropped — no users** (with M4). The spike's migration recipe is no longer needed.
- [M7 · Land DB v3 + migration](tickets/M7-land-db-v3-migration.md) — **Landed (v3 only, migration removed)**: DB v3 + `SyncRecord` v2 (kind/writer), storage helpers, `service.ts` on the per-identity-record model (setup/unlock/recovery/re-enroll/save/joinImport), `meta.deviceId` boot detection. **76/76 tests + build green.** Known limit → M8: foreign-writer records need the lazy-decrypt path.
- [M8 · Land the record bridge](tickets/M8-land-record-bridge.md) — **Landed**: `bridge.ts` (diffVault / pushChanges / mergeIncoming / pushSave / syncNow) behind the experimental flag; adapter `docIdFromTicket` + persisted node identity (`start_with_secret_key` on reload, SecretKey/author persisted on first start); pairing/join persist the doc capability; `useVault.save` → outbound push, identities screen → inbound sync. 3 bridge unit tests; **79/79 green**. Gaps: live delivery experimental (M2/S7); foreign-writer records read lazily via the code.

## Not yet specified

- **Sync status UX** (last-synced at, pending changes, relay reachability) — needs live sync reliability to be meaningful; wait on M2.
- **Existing-vault adopt-code join — LANDED (2026-08-15).** `adoptHostCode` in `records.ts` (rotation under the host's code + B's existing passkey, merge by uuid, local wins on conflict); `/join` now reachable from locked/unlocked; JoinScreen gains a local-unlock step (locked) + an adopt branch, and hands off to `/` on success (route-not-screen, per the routing map). Unit-tested. Removed from fog.
- **Invitation deep links / Web Share target** — QR + copy-string invitations landed (2026-08-15, `uqr`); **QR scanning landed (2026-08-15, `@zxing/browser`)** — `/join` Paste/Scan-QR toggle. Deep links / share-target from outside the app still open.
- **Native (Node/CLI) relay-side participant** as a fallback if browser sync stays unreliable (S7 option) — a big fork; revisit after M2.

## Out of scope

- **The v1/v2 blob format + the in-place migration** — dropped (2026-08-15, human: "no users yet"): the app starts fresh at v3. M4 + M10 superseded.
- The Spectre **passphrase** — never leaves the device, never syncs.
- **Background/periodic sync** — foreground + online only. Revived as its own effort: **Sync-bg** (`.wayfinder/sync-bg/map.md`).
- **WebRTC / direct browser-to-browser** connections.
- **Cross-user sharing** — anything beyond the user's own devices.
- **Fixing the upstream iroh-docs browser-sync engine** — tracked via M2, not fixable in this repo.
