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
User-chosen code typed at unlock; derives the KEK that unwraps a DEK. The universal unwrap — the joining path for a new device before it enrolls its own passkey.

## Passkey
WebAuthn credential (PRF extension) bound to one device; wraps that device's DEK only. Not transferable across devices.

## Pairing / Invitation
The iroh doc capability (doc id + write capability) conveyed by QR or a short invitation string, letting a second device join the sync doc.

## Relay
n0 public relay server; browser nodes connect over WebSocket and cannot hole-punch, so all browser traffic flows via a relay. E2E-encrypted — the relay sees only ciphertext.
