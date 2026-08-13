# Spectre Pocket — Ubiquitous Language

## Spectre Pocket
The installable, offline-first PWA: a Spectre password-cipher vault unlocked by passkey, with the passphrase typed on every launch and never persisted.

## Spectre Pocket Sync
The new effort on top of v1: peer-to-peer vault sync between a user's own devices over iroh. Deliberately NOT v1's offline-only promise — a fresh destination, not a resumption.

## Identity record
One encrypted entry per Spectre identity (fullName, algorithm version, sites[]) in the synced vault. The merge unit: two devices editing different sites of the *same* identity still resolve by whole-record last-writer-wins.

## DEK (Data Encryption Key)
The AES-GCM key that encrypts a device's identity records. **Per-device**: never shared, never shipped in plaintext. Synced records are decrypted (with the remote device's DEK) and re-encrypted under the local device's DEK during a merge.

## Envelope
Non-secret header record(s) holding each device's wrapped DEKs — passkey-wrapped and recovery-code-wrapped copies. Syncs in the doc so any device can unwrap any device's DEK.

## Recovery code
User-chosen code typed at unlock; derives the KEK that unwraps a DEK. The universal unwrap — the joining path for a new device before it enrolls its own passkey.

## Passkey
WebAuthn credential (PRF extension) bound to one device; wraps that device's DEK only. Not transferable across devices.

## Pairing / Invitation
The iroh doc capability (doc id + write capability) conveyed by QR or a short invitation string, letting a second device join the sync doc.

## Relay
n0 public relay server; browser nodes connect over WebSocket and cannot hole-punch, so all browser traffic flows via a relay. E2E-encrypted — the relay sees only ciphertext.
