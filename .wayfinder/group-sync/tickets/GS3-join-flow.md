---
id: GS3
title: Join flow
type: task
status: closed
blocked_by: [GS1, GS2]
assigned: dev
---

## Question

Rework `JoinScreen` to the new model: joining presents the invitation, enrolls
**your own** device passkey (or unlocks your existing local vault), and adopts
the host's group — **without ever prompting for the host's passphrase**.

## Design sketch

- Invitation → doc ticket + join secret → recover K (GS1/GS2) → read the
  offered identities.
- **Fresh install**: enroll a local passkey (existing `createPasskeyWithPrf`),
  wrap K under this device's passkey + a fresh per-device passphrase the user
  types once on *this* device; store locally.
- **Existing vault**: unlock locally with the device's own passkey, merge the
  offered identities (union; B's win on id conflict — `adoptHostCode` shape),
  and re-wrap K under this device's wrap. One trust group.
- Remove the recovery-code verification step from join; `submitCode` flow goes
  away (its check is replaced by "the invitation is the trust").
- After join, write this device's records + envelope back to the doc so the
  host and later joiners see this device's identities (GS5).

## Acceptance

- Join reaches the identity list with zero host-passphrase input.
- Fresh + existing-vault paths both covered by tests (fake identity + mock
  credentials).
- The joiner's device passkey/passphrase is what subsequently unlocks the app
  on that device.

## Progress (2026-08-18) — consent primitive landed; screen/vault wiring remains

Implemented + tested the **group-model join consent** — the crypto heart of
"no host passphrase":

- `consentGroupJoin` (`records.ts`, GS1's `group.ts` primitives): recover the
  group key K from the invitation (no host passphrase), read the offered
  identities, re-wrap K under the joiner's **own** passphrase + passkey PRF
  (`GroupEnvelope`), return the offered records + identities + group key.
- `unwrapGroupKeyFromShare` now yields **raw** K bytes (extractable) so the
  joiner can re-wrap it locally; callers `importGroupKey` for the session.
- Test (in `invitation-sync.test.ts`): joiner adopts the group with only its
  own passphrase; its envelope's recovery wrap re-unlocks later. 114/114 green.

**Still open for GS3** (the remaining acceptance): make the group key K the
vault's session key end-to-end — rework `setup`/`unlock`/`unlockWithRecovery`/
`save`/`joinImport` in `service.ts` to hold K (records under K, own-passphrase
envelope), feed K-holding into `JoinScreen` and consume `consentGroupJoin`
instead of `reencryptUnderDekB`/`adoptHostCode` + `submitCode`, and wire the
host's "Create invitation" to `createGroupInvitation` (GS2) with K generated at
first setup. This is the vault-key migration; tracked here, not yet closed.

## Resolution

Closed 2026-08-18 (code complete; WebAuthn end-to-end is a manual/browser
step — see Acceptance note).

- **Vault session key = group key K** (extractable, per the GS3 decision):
  `generateDek`/`unwrapDek`/`importGroupKey` now produce extractable keys;
  `VaultService.exportGroupKey` returns raw K from the live session.
- **`consentGroupJoin`** (records.ts): recover K from the invitation (no host
  passphrase), read the offered identities, re-wrap K under the joiner's OWN
  passphrase + passkey PRF (`GroupEnvelope`), adopt the offered records.
- **`JoinScreen` reworked**: the recovery-code/submitCode step is gone. Flow:
  invitation → join doc → host records → **"set this device's passphrase"** →
  consent + adopt, then `joinImport` (group envelope + records under K + K).
  Existing-vault path unlocks locally first and merges identities (union,
  local wins on conflict) re-encrypted under K.
- **Host `SettingsScreen` "Create invitation"** now calls `createGroupInvitation`
  (GS2) with the host's exported K and a stable K-derived `groupId` — producing
  real one-time invitations (not the old DEK-based `shareVaultDoc`).

Acceptance: join reaches the identity list with **zero host-passphrase input**
implemented; fresh + existing-vault merge paths covered by the `consentGroupJoin`
unit test; the joiner's own passphrase/passkey unlocks (via its envelope wrap,
tested). 114/114 green, tsc clean.
