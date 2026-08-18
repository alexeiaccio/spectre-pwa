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
