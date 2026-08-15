---
id: M8
title: Land the record bridge
type: task
status: closed
blocked_by: [M5, M6]
assigned: dev
---

## Question

Implement the record bridge + incoming merge per M5, on top of M7's v3 mirror and M6's node mirror:

- Outbound push on local edits (per-identity records under this device's DEK, write-on-change, fresh IVs; deletes per S2).
- Inbound merge into the mirror (LWW by v1 uuid, re-encrypt on change only).
- Wire to the sync adapter (`src/lib/sync/`) + the pairing/join flows; all behind the experimental flag with the banner.
- Tests: unit tests for bridge push/merge decisions; browser test for an edit → pushed record → mirrored back round-trip where the flag allows.
- Resolved when green. Record decisions + remaining gaps (e.g. live delivery reliability per M2) in the resolution.

## Resolution

**Landed** (`src/lib/sync/bridge.ts` + adapter/pairing/join wiring), per M5, behind the experimental flag.

- **`bridge.ts`**: `diffVault` (JSON deep-equality, write-on-change — no ping-pong), `pushChanges` (changed identities as records under `writer: deviceId` + removals as tombstones), `mergeIncoming` (re-read known keys into the mirror **as-received**; LWW already resolved by the doc), `pushSave` (outbound: fired after a local save when a vault doc is persisted — fire-and-forget, swallowed failures, mirror is source of truth), `syncNow` (inbound: poll the union of the host pointer's ids + local mirror ids).
- **Adapter**: `docIdFromTicket(ticket)` added to `SyncAdapter`; `ensure()` now starts from a persisted SecretKey (`start_with_secret_key`) and persists the SecretKey + author on first start; `persistDoc(ticket, docId)` writes the doc capability to `node.doc`/`node.docId` (M6).
- **Wiring**: pairing (`shareVaultDoc`) and join (`JoinScreen`) persist the doc capability; `useVault.save` fires `pushSave`; the identities screen fires `syncNow` (App ScreenShell effect).
- **Tests**: 3 bridge unit tests (diff decisions, writer + tombstone writes, decrypt-back under the device DEK). **79/79 green, build + format clean.**
- **Remaining gaps (M2/S7)**: live browser delivery is still experimental/unreliable; `mergeIncoming` covers known keys (host pointer + local), new identities from the host need a pointer refresh; foreign-writer records read lazily via the writer's envelope + recovery code (the code isn't in memory after a passkey unlock — a documented read-path limitation).
