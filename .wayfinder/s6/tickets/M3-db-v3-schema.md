---
id: M3
title: DB v3 schema and store layout
type: grilling
status: closed
blocked_by: []
assigned: dev
---

## Question

Pin the concrete DB `spectre-pocket` v3 layout (S6 resolution gives the shape; this tickets the detail):

- **Stores**: `records` (per-identity, key = v1 identity uuid → encrypted record under the last writer's DEK, per S2), `envelope` (per-device, key = device id → `DeviceEnvelope`, now carrying prfSalt/credId on passkey wraps), `node` (the iroh SecretKey + doc capability), `prefs` (unchanged, local-only).
- **Versioning**: DB_VERSION 2 → 3; `onupgradeneeded` migration vs create-new; what happens to the v1 `vault` store (drop after migration).
- **Record shape**: the `IdentityRecord` from `src/lib/sync/types.ts` (v1, iv, ct) — reuse as-is? Is a tombstone format needed for deletes (S2)?
- **Backward compat**: v2 envelopes without prfSalt/credId (pre-2026-08-14) — the migration must handle them (recovery-code path) or reject cleanly.
- **Where the session DEK lives**: per-device envelope in the mirror; the in-memory session stays as today.
- Deliverable: the concrete schema/types (mirroring the current `schema.ts`), ready for M7.

## Resolution

Pinned by grilling with the human (2026-08-14). **Tombstones in now**; **separate `meta` store**.

### Store layout (DB `spectre-pocket` v3)

| Store | Key | Value |
|---|---|---|
| `records` | identity uuid | `SyncRecord` (below) |
| `envelope` | device id | `DeviceEnvelope` (existing, v1, prfSalt/credId on passkey wraps) |
| `node` | `'secret'` / `'doc'` / `'author'` | SecretKey hex / DocTicket / author key hex (per M1) |
| `meta` | `'device'` / `'migrated'` | current deviceId / boolean |
| `prefs` | `'root'` | unchanged |
| `vault` | — | **dropped after** app-level migration (M4) |

### Record type — one canonical shape for mirror AND doc wire (S2 deletes)

```ts
// sync/types.ts — replaces the v1 IdentityRecord; the mirror stores it directly
// (IndexedDB structured-clones the ArrayBuffers), the doc codec base64s it.
export type SyncRecord =
  | { v: 2; kind: 'record'; iv: ArrayBuffer; ct: ArrayBuffer }
  | { v: 2; kind: 'tombstone' }
```

- `encodeRecordDoc`/`decodeRecordDoc` updated to the v2 format; `decodeRecordDoc` must accept v1 (`{v:1, iv, ct}`) as a live record for old docs.
- `encodeIdentityRecord`/`decodeIdentityRecord` (records.ts) operate on the `record` kind; a tombstone has no ciphertext.

### Versioning / migration hooks

- `DB_VERSION = 3`. `onupgradeneeded` (v2→v3) **creates** `records`/`node`/`meta`; **keeps** the v1 `vault` store + `envelope` "root" row so the app-level migration (M4) can read them. After migration completes, the app clears the `vault` store and sets `meta.migrated = true`.
- Backward compat: a v2 envelope at key `root` without prfSalt/credId is the migration's input (M4 handles the recovery-code path / fresh re-wrap).

### Unlock model (for M7)

`meta.device` → that device's envelope → unwrap DEK (passkey via prfSalt+credId, or recovery) → for each `records` entry: decrypt under the last writer's DEK (own DEK, or a foreign device's envelope unwrapped via the recovery code, per S3). In-memory session holder stays as today.
