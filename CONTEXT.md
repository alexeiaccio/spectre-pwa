# Spectre Pocket — Ubiquitous Language

## Spectre Pocket
The installable, offline-first PWA: a Spectre password-cipher vault unlocked by passkey, with the passphrase typed on every launch and never persisted.

## Spectre Pocket Sync
The new effort on top of v1: peer-to-peer vault sync between a user's own devices over iroh. Deliberately NOT v1's offline-only promise — a fresh destination, not a resumption.

## Identity record
One encrypted entry per Spectre identity (fullName, algorithm version, sites[]) in the sync doc, keyed by the **v1 identity uuid**. The merge unit and the LWW winner: ciphertext sits under the **last writer's DEK**, and any device can read it by unwrapping that writer's DEK from their envelope. Rewritten (re-encrypted under the writer's own DEK) only on content change.

## DEK (Data Encryption Key)
The AES-GCM key that encrypts a device's identity records. **Per-device**: never shared, never shipped in plaintext. A record's ciphertext always sits under the **last writer's** DEK; a device that *changes* an identity re-encrypts the whole record under its own DEK (no per-read re-encryption, no ping-pong).

## Envelope
Non-secret record per device in the sync doc (keyed by device id) holding that device's wrapped DEKs — passkey-wrapped and recovery-code-wrapped copies. Readable by all; the recovery code unwraps any device's DEK. Device membership is implicit in the envelope records present.

## Recovery code
User-chosen, **vault-wide** code typed at unlock; derives the KEK that unwraps a DEK. The universal unwrap: any device's envelope carries a recovery-wrapped copy of its DEK, so the code opens any device's records before it enrolls its own passkey. Whoever holds the code + a doc copy can read every record — accepted (as in v1).

## Passkey
WebAuthn credential (PRF extension) bound to one device; wraps that device's DEK only. Not transferable across devices.

## Durable mirror
The IndexedDB layer (DB `spectre-pocket` v3) that persists what iroh's memory-only browser store cannot: per-identity `records`, per-device `envelope`s, the iroh `node` identity (SecretKey + doc id/capability), and prefs. Re-imported into iroh-docs on launch. All prefs are local-only.

## Migration
In-place, at the **first unlock after upgrade**: decrypt the v1 single blob (passkey or recovery code), split into per-identity records, re-encrypt under device A's DEK, write the mirror + A's envelope. The migrated DEK becomes the first device's DEK; re-enroll uses the normal two-phase rotation.

## Pairing / Invitation
The iroh doc capability (doc id + write capability) conveyed by QR or a short invitation string, letting a second device join the sync doc. Joining grants **Write** capability — a joined device can clobber records via LWW (no revocation) — accepted trust boundary.

## Join
Device B's onboarding: invitation (QR/string) → sync the doc → type the **host's** recovery code (verified by unwrapping the host's envelope) → re-wrap/re-encrypt under DEK-B → enroll passkey. An existing vault can join by **adopting the host's code** (its old code dies); identities merge by v1 uuid with LWW resolving collisions.

## Relay
n0 public relay server; browser nodes connect over WebSocket and cannot hole-punch, so all browser traffic flows via a relay. E2E-encrypted — the relay sees only ciphertext.
