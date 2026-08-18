---
id: GS6
title: Revoke a device via key rotation
type: prototype
status: open
blocked_by: [GS1, GS5]
assigned:
---

## Question

How do you actually **remove a device from the group** — i.e. stop it from
reading/writing the shared identities? Because every device holds the shared
group key K, "removing" a device from a list is not enough: the removed device
keeps K and past records, so it can still decrypt and keep participating.
Real revocation = **rotate to a new group key epoch K′** and re-encrypt.

## Design sketch

- On "Remove connection" for device X:
  1. Generate a fresh group key K′ (new epoch) on the acting (host) device.
  2. Re-encrypt every shared identity record under K′.
  3. Re-share K′ only to the **remaining** group devices (their envelopes
     re-wrap K′ under their own unlocks) — device X's envelope is dropped from
     the doc and X is never given K′.
  4. Tombstone/clear X's participation; bump the group-key epoch so stale
     mirrors detect a mismatch.

## Consequences (be explicit)

- The removed device's *old* records it already holds remain readable by it
  (you cannot un-remember). What you prevent: future reads/writes under K′.
- Requires re-encryption + a K′ fan-out to all remaining devices (a write on
  the ongoing GS5 sync), so all devices must be reachable or at least will
  converge on their next sync.

## Acceptance

- After rotation, a removed device's stored envelope + records can no longer
  decrypt new writes, and the removed device is absent from the group's
  device list / envelope set.
- Remaining devices converge on K′ and read each other's re-encrypted records.
- Epoch mismatch on a stale mirror surfaces clearly (status UX, GS5).

## Progress (2026-08-18) — mechanism implemented + tested; integration remains

**Done + tested (crypto core):**
- Each device mints an **ECDH (P-256) keypair** at join (`consentGroupJoin`);
  `GroupEnvelope` carries `devicePublic` (plaintext) + `deviceSecret` (ECDH
  private pkcs8 DER wrapped under the device's own unlock). `group.ts`:
  `generateDeviceKeypair`, `deriveSharedKey`, `encryptRekey`, `decryptRekey`,
  `unwrapRawSecret`.
- `rotation.ts`:
  - `rotateGroupKey` (host): generate K′, re-encrypt all shared records under
    it, rewrap K′ into the host's envelope, and emit a per-device
    `rekey/<deviceId>` record (K′ ECDH-encrypted to each *remaining* device).
  - `consumeRekey` (device): unwrap own `deviceSecret`, ECDH-decrypt the
    rekey → K′ → rewrap under its own unlock.
- `types.ts`: `RekeyRecord` + `rekeyKey(deviceId)` doc keys.
- `tests/unit/rotation-sync.test.ts` (3): rekey goes only to remaining
  devices (not the removed one); a removed device can't decrypt a remaining
  device's rekey; a removed device holding the old K can't read post-rotation
  records. 123/123 green, tsc clean.

**Still needed for a complete GS6 (integration/UI):**
1. **Session device-key holder**: hold the device ECDH private in the unlocked
   `VaultSession` (unlock unwraps `deviceSecret` alongside K) so the background
   runner can auto-consume `rekey/<thisDevice>` without re-prompting.
2. **Host "Remove connection" action** (settings paired-devices list): calls
   `rotateGroupKey` with the removed ids, writes `records` + rekeys +
   `hostEnvelope` to the doc.
3. **Runner wiring**: on each sync pass, check `rekey/<thisDeviceId>`, consume,
   switch the session to K′ (and re-import mirror records under K′).
These are the wired flok; the revocation guarantee is proven at the crypto
layer above.
