---
id: S3
title: Per-device DEK re-encryption and unlock protocol
type: grilling
status: open
blocked_by: [S1, S2]
assigned:
---

## Question

Pin down the crypto path end-to-end:

- **Key wraps**: each device's DEK is wrapped under (a) its passkey PRF and (b) the recovery code. The recovery code must unwrap ANY device's DEK — confirm the recovery-wrapped copy of each DEK syncs in the doc alongside identity records.
- **Merge**: device B receives A's identity record (ciphertext under DEK-A) + A's envelope; B types the recovery code, unwraps DEK-A, decrypts, merges, re-encrypts under DEK-B. Confirm. No plaintext DEK and no plaintext record ever ships; relay sees only ciphertext.
- **Atomicity**: crash mid-merge (B wrote its merged record but the canonical-index entry didn't update) — how does the doc stay consistent?
- **Nonce/IV discipline**: AES-GCM over many records and repeated re-encryptions — unique IV per encryption; are IVs random or derived (e.g. HKDF(DEK, recordId)) to avoid reuse on re-encrypt of the same record?
- **Interaction with v1 re-enroll (T4)**: v1 rotates a shared DEK and re-encrypts the single blob. With per-device DEKs, does re-enroll become "rotate *my* DEK, re-encrypt *my* records" — and what happens to records synced in from other devices?
- **Passphrase**: the Spectre master secret rides inside the identity record ciphertext only, never leaves the device — confirm.
