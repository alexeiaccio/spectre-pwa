# Group sync — shared-key trust model, invitation-based join, periodic sync

> Map issue · local markdown tracker · label: `wayfinder:map`
> Tracking conventions: see `README.md` in this tracker. Tickets live in `tickets/`.

## Destination

Rework Spectre Pocket's device sync around a **single shared group key** so
that:

1. **Invitation = trust.** Joining a sync group does not require the host's
   passphrase/recovery code — the invitation itself is a one-time, one-device
   trust grant.
2. **Credentials stay on-device.** Each device unlocks with its *own* passkey +
   passphrase, never another device's. You never type a host's passphrase when
   you join.
3. **Choose identities before sharing.** The host selects which identities an
   invitation offers, not all-or-nothing.
4. **Periodic sync between all devices.** Shared identities converge across the
   group without requiring cross-device passphrases.

## Background / why

Today (v1 sync, S5): each device has its **own DEK** and identity records are
encrypted under the *writer's* DEK. Reading another device's records requires
unwrapping that device's DEK, and the only shared secret is the host's recovery
code — so the join flow prompts for the host's passphrase
(`reencryptUnderDekB`), and cross-device *periodic* sync is impossible without
some shared secret. The S5 join is also all-identities (the host pointer lists
every identity).

The relay side is solved and deployed (iroh-worker at
`relay0.iroh.accio.blue`; spectre-pwa now ships `RelayMode::Custom` pointing at
it). This effort is the app-side trust/schema/flow redesign on top.

## Design decisions (confirmed 2026-08-18)

- **Single group key K** for all shared identities, held by every trusted
  device. Identity records encrypt under K, so any group device reads/writes
  any record → periodic sync needs no cross-device passphrase. Tradeoff
  accepted: a compromised device can decrypt the group's shared identities
  (which it holds anyway).
- **Per-device local unlock.** Each device wraps its copy of K under its own
  passkey + its own per-device passphrase/recovery string. Credentials never
  leave the device; no cross-device passphrase is entered.
- **Invitation = one-time trust handoff.** Host picks identities → writes them
  into a fresh sync doc → the invitation carries a one-time **join secret**
  that unlocks K for that join. First join consumes it; the host rotates the
  join secret so the string is single-use for a single new device.
- **Joiner who already has a vault adopts the host group (union).** B keeps its
  local identities, merges A's shared identities on id (B's win on conflict),
  and both drift onto a single shared K; all become one trust group.
- Planning-first: tickets below; implement incrementally with tests.

## Decisions so far

<!-- one line per closed ticket -->

- [GS1 · Group key + schema](tickets/GS1-group-key-schema.md) — closed: shared
  group key K + per-device wraps (`group.ts`), v2 `GroupEnvelope` codec, and
  the one-time share-secret primitive (recover-K, wrong-S-fails,
  rotation-invalidates-old). Cross-device read under independent unlockers
  tested. Additive; 109/109 green.
- [GS2 · Invitation handoff](tickets/GS2-invitation-handoff.md) — closed:
  `invitation.ts` — wire format, `createGroupInvitation` (chosen identities →
  doc under K → one-time secret S), `rotateGroupInvitation` (fresh S renders the
  prior invitation non-reusable). Only chosen ids hit the doc; joiner recovers K
  from the invite. 4 tests; 113/113 green.
- [GS3 · Join flow](tickets/GS3-join-flow.md) — closed: vault session key =
  group key K (extractable, per decision), `exportGroupKey`, `consentGroupJoin`
  (recover K from invitation, re-wrap under the joiner's own passphrase +
  passkey, adopt/merge), JoinScreen reworked (no host-passphrase step), and the
  host "Create invitation" produces GS2 invitations from K. WebAuthn
  end-to-end remains a manual/browser validation. 114/114 green.

## Not yet specified

- [GS4 · Identity picker on host](tickets/GS4-identity-picker.md) — open.
  Multi-select on the host before generating an invitation; only those
  identities are offered and later synced.
- [GS5 · Periodic cross-device sync](tickets/GS5-periodic-sync.md) — open
  (blocked by GS1). Read/write all shared records under K on a timer /
  open-app + visibility triggers; sync-status UX.
- [GS6 · Revoke a device via key rotation](tickets/GS6-revoke-device.md) — open
  (blocked by GS1, GS5). Real "remove connection": rotate to a new group key
  epoch K′, re-encrypt all shared records, re-share K′ only to remaining
  devices. The removed device still holds its old records, but can no longer
  decrypt new writes. Decision (2026-08-18): real revocation, not UI-only.

## Device-management UI (folds into GS5/GS6, decided 2026-08-18)

Settings gains a **"Paired devices"** section built from the doc's
`env/<deviceId>` envelope set (free to enumerate). Per device:
- **Reconnect** — re-establish the sync session / retry (manual trigger).
- **Resync now** — pull+push under K on demand.
- **Last synced / status** — from GS5's status UX.
- **Remove connection** — real revocation (GS6: key rotation), not UI-only.

## Out of scope

- The relay itself (iroh-worker repo; done and deployed).
- Per-identity vs group key granularity (decision: group key).
- Revoking a device is *not* out of scope — it is a real, tracked feature
  (GS6, key rotation). Note the inherent limit: a removed device always keeps
  the records it already held; rotation stops future reads/writes only.
