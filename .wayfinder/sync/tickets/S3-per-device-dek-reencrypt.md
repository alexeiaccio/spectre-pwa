---
id: S3
title: Per-device DEK re-encryption and unlock protocol
type: grilling
status: closed
blocked_by: []
assigned: dev
---

## Question

Pin down the crypto path end-to-end:

- **Key wraps**: each device's DEK is wrapped under (a) its passkey PRF and (b) the recovery code. The recovery code must unwrap ANY device's DEK — confirm the recovery-wrapped copy of each DEK syncs in the doc alongside identity records.
- **Merge**: device B receives A's identity record (ciphertext under DEK-A) + A's envelope; B types the recovery code, unwraps DEK-A, decrypts, merges, re-encrypts under DEK-B. Confirm. No plaintext DEK and no plaintext record ever ships; relay sees only ciphertext.
- **Atomicity**: crash mid-merge (B wrote its merged record but the canonical-index entry didn't update) — how does the doc stay consistent?
- **Nonce/IV discipline**: AES-GCM over many records and repeated re-encryptions — unique IV per encryption; are IVs random or derived (e.g. HKDF(DEK, recordId)) to avoid reuse on re-encrypt of the same record?
- **Interaction with v1 re-enroll (T4)**: v1 rotates a shared DEK and re-encrypts the single blob. With per-device DEKs, does re-enroll become "rotate *my* DEK, re-encrypt *my* records" — and what happens to records synced in from other devices?
- **Passphrase**: the Spectre master secret rides inside the identity record ciphertext only, never leaves the device — confirm.

## Resolution

- **Recovery code is vault-wide** (as v1). One code shared by all devices; every device's envelope wraps its own DEK under that code, so any device can unwrap any other's DEK. Consequence accepted: whoever has the code + a doc copy can read every record — same trust as v1.
- **Read/merge path confirmed**: B unwraps DEK-A from A's envelope with the typed recovery code, decrypts A's identity record, merges into its local tree, and re-encrypts under DEK-B **only if B actually changes that identity** (S2: rewrite only on content change). No plaintext DEK, no plaintext record ships; the relay and doc peers see only ciphertext.
- **No cross-record consistency index** — the v1 "single blob + canonical index" atomicity worry is gone: each identity record is independently atomic in the doc (per-key LWW). A crash mid-merge leaves some records updated, others not — that's a normal partial sync, not corruption; the next sync reconciles. The only multi-record operation needing care is **DEK rotation** (below).
- **IV discipline: fresh random 12-byte IV per encryption** (v1 already does this). Collision-safe at realistic record counts; no per-record derived state to maintain across re-encrypts.
- **DEK rotation / passkey re-enroll = two-phase, rotates only this device's records**:
  1. write new envelope with **both** old and new wraps present;
  2. re-encrypt this device's records (those last written under DEK-old) under DEK-new, one by one;
  3. rewrite the envelope dropping the old wrap.
  Crash-safe at every step: the old wrap stays valid until all records are re-encrypted. Records last written by other devices are untouched and stay readable via their envelopes ("rotate mine, touch others not").
- **Passphrase / master secret**: the Spectre master secret lives *inside* identity record ciphertext only. It *does* move between the user's own devices via sync — but always encrypted under the writer's DEK, never as plaintext, never on the relay as anything but ciphertext. The per-launch typed passphrase still derives nothing that persists; the DEK layer is unchanged in role from v1, just per-device.
- **Trust boundary (from map, confirmed)**: anyone holding the doc's Write ticket can overwrite/delete any record via LWW — iroh-docs has no revocation of write capability. Pairing shares that ticket only with the user's own devices.
