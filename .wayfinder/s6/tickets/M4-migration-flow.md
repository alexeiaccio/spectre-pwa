---
id: M4
title: Migration flow — first unlock after upgrade
type: grilling
status: closed
blocked_by: []
assigned: dev
---

## Question

Pin the in-place migration at the **first unlock after upgrade** (S6 resolution):

- **Detection**: how does boot detect a v2 vault needing migration (DB version + presence of the old `vault` blob) vs a fresh v3 vault vs a fresh install?
- **State**: the `{ view: 'migrating' }` union case (routed in the routing seam) — what it shows, when it transitions to `locked`/`identities`.
- **Step order + crash-safety** (per S3's "no cross-record index" stance): read v2 envelope + blob → decrypt with passkey/recovery → split into per-identity records → re-encrypt each under A's DEK (fresh IVs) → write v3 `records` + A's `envelope` (device id, prfSalt/credId forward) → drop the v1 blob. What is the commit point; can a crash mid-migration leave a recoverable state?
- **Failure handling**: v2 envelope missing prfSalt/credId (pre-fix) — recovery-code path; migration failure → error screen with retry, never a silent vault loss.
- **Interaction with `useVault`**: boot/unlock/setup semantics before vs after migration; does the app offer "start syncing" only post-migration?
- Deliverable: the migration flow spec for M7.

## Resolution

Confirmed by grilling with the human (2026-08-14). **Unlock-first, commit = `meta.migrated`, idempotent re-run.**

### Boot detection (`useVault.boot`)

1. `meta.migrated === true` → v3 vault → normal `locked`/`unlocked` boot.
2. `meta.migrated` unset **and** v1 `vault` blob present → **needs migration**.
3. neither → fresh install → `needs-setup`.

New `VaultStatus` kind **`needs-migration`**; `deriveScreen` maps it to the existing `{ view: 'migrating' }` union case (no routing change — the case is already reserved).

### Flow (unlock-first, because migration needs the DEK)

1. The `migrating` view shows the unlock affordance (passkey *and* recovery) + "Migrating your vault…" note. For a v2 passkey record **without** prfSalt/credId (pre-2026-08-14 envelopes), passkey is disabled and only the **recovery-code path** is offered, with a note.
2. On unlock: read v2 `envelope`("root") + `vault` blob → unwrap DEK → decrypt → split into per-identity `SyncRecord`s → re-encrypt each under **A's DEK** (fresh random IVs) → write `records` + A's `DeviceEnvelope` (deviceId = fresh uuid; passkey wrap prfSalt/credId forwarded when present) + `meta.device`.
3. **Commit point = `meta.migrated = true`.** Then best-effort clear of the v1 `vault` store + `envelope` "root" row (leftover v1 blob with migrated=true is harmless garbage).

### Crash-safety

Idempotent + re-runnable: records are deterministic per identity, the v1 blob survives untouched until the commit point, and a crash mid-run re-runs on next boot. **Never a silent vault loss.** Migration failure → error + retry with the v1 data intact.

### useVault interaction

`boot` branches on the detection above; after migration the status is `unlocked` (same as a normal unlock). The pairing section lives on the identities screen, so "start syncing" is naturally post-migration only.
