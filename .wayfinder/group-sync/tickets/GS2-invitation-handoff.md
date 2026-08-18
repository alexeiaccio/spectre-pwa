---
id: GS2
title: Invitation handoff
type: prototype
status: open
blocked_by: [GS1]
assigned:
---

## Question

Turn an invitation into a **one-time, one-device trust grant** that carries the
identities the host chose (GS4) and the join secret needed to recover K — with
no host-passphrase prompt, and with reuse/rotation handled.

## Design sketch

- Host picks `identityIds` (GS4) → writes those identities into a fresh sync
  doc (encrypted under K, as GS1) → creates an invitation.
- Invitation string = the doc ticket **plus** a one-time join secret S carrying
  the K-recovery material (see GS1's join-secret primitive). Because possession
  of the invitation is the trust (per design decision), S may travel in the
  invitation itself; it must be consumed so a re-join/re-share can't reuse it.
- **Single-use**: host marks S consumed on the first successful join and rotates
  it (fresh invitation invalidates the prior). Since the joiner must dial the
  host to sync, the host observes the join and rotates.
- Keep the QR/copy surface (`SettingsScreen` → invitation) working with the new
  invitation format.

## Questions

- Should the invitation carry K directly, or a wrapper that only the *intended*
  recipient can open? (Scoping: a shared invitation is copied/pasted, so
  "intended recipient" is by possession today. Confirm this is acceptable for
  v1 — see map's security note.)

## Acceptance

- Invitation generates, copy/QR round-trips, and joiner derives K enough to read
  the offered identities.
- A second join with the same invitation is refused (consumed).
- Only `identityIds` chosen on the host are present in the doc on join.
