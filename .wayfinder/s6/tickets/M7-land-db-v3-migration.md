---
id: M7
title: Land DB v3 + migration
type: task
status: closed
blocked_by: [M3, M4]
assigned: dev
---

## Question

The main build: implement the v3 mirror + the first-unlock migration per M3/M4.

- New `storage.ts` layout (records/envelope/node/prefs), DB v3, `onupgradeneeded`.
- The `migrating` screen (routing seam case) + migration flow (v2 blob → per-identity records under A's DEK, prfSalt/credId forward, v1 blob dropped).
- `useVault` boot/unlock semantics around migration; failure handling with the recovery-code fallback.
- Tests: browser test for a v2 fixture → migrate → v3 state + unlock; unit tests for record split/re-encrypt.
- Resolved when the suite is green on the v3 model. Record config + decisions in the resolution.

## Resolution

**Landed.** DB v3 + per-identity-record vault + first-unlock migration, following the concurrent Effect-Schema refactor's conventions.

- **Schema/storage**: `DB_VERSION = 3`; stores `records` (uuid → `SyncRecord`), `envelope` (deviceId → Envelope), `node`, `meta`; v1 `vault` store kept until migration. `storage.ts` gains `readRecord`/`writeRecord`/`writeRecords`/`getAllRecords`/`readDeviceEnvelope`/`writeDeviceEnvelope`/`readMeta`/`writeMeta`/`readNodeIdentity`/`writeNodeIdentity`/`hasLegacyVault`/`clearLegacyData`.
- **SyncRecord v2** (kind `record`|`tombstone`, `writer: deviceId`) in `sync/types.ts` (v1 doc decode tolerated) + `records.ts`; pairing + JoinScreen write the writer; joinImport takes the v3 payload `{ deviceId, envelope, records, dek }`.
- **Service** (`service.ts`) rewritten to the record model: `setup` (v3 device envelope + meta), `unlock`/`unlockWithRecovery` (meta.device → device envelope → DEK → `loadVault`), `reEnrollPasskey` (rotate DEK, rewrite records), `save` (write changed identities + tombstone removals), `joinImport`, and **`migrate`** (M4 recipe: unwrap v2 DEK → decrypt blob → per-identity records under A's DEK → v3 stores → commit `meta.migrated` → clear legacy).
- **UI**: `needs-migration` status + boot detection in `useVault`; `{ view: 'migrating' }` in the Screen union; `MigratingScreen` (unlock-with-passkey / recovery) wired in App.
- **Verified**: 80/80 tests (new migration browser suite: manual v2 fixture → migrate → v3 records + unlock + wrong-code + idempotency; re-enroll updated to v3 envelope access; sync-join on v2). Build green. **Real-browser smoke**: the migrating view renders against a genuine v2 vault (boot detection works).
- **Known limitations → M8**: `loadVault` decrypts mirror records under the local DEK (true post-migration/post-join, all records own-DEK); foreign-writer records from live sync need M8's lazy-decrypt via the writer's envelope + recovery. A wrong recovery code surfaces as "unwrapKey failed" (raw AEAD) — friendlier mapping is a small follow-up.
