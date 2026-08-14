---
id: S6
title: Vault-store migration to iroh-docs
type: grilling
status: closed
blocked_by: []
assigned: dev
---

## Question

With iroh-docs as the primary store, what happens to existing v1 installs?

- **Migration**: v1 IndexedDB (DB `spectre-pocket` v2: one envelope + one ciphertext blob) → per-record doc: in-place migration on upgrade, or fresh re-setup?
- **Persistence**: does iroh's browser store live in IndexedDB itself (see S1) or a separate persistence layer — does the app keep one DB or two? Does the v1 DB/version story change?
- **Re-enroll**: v1 re-enroll (T4) rotates a shared DEK and re-encrypts the blob; with per-device DEKs, re-enroll becomes "rotate my DEK, re-encrypt my records" — what breaks, what survives?
- **prefs**: theme + autoLockMinutes — synced or stay local?

## Resolution

- **Migration is in-place, at first unlock after upgrade** (passkey or recovery code). Flow: decrypt the v1 blob → split identities into per-identity records → re-encrypt each under device A's DEK (which becomes the migrated vault's first device DEK) → write the durable mirror + A's envelope record. One-time; gated on a successful unlock (migration *cannot* run at boot — the blob is encrypted). No fresh re-setup, no data loss.
- **Durable mirror lives in the same DB, bumped to v3** (`spectre-pocket` v3). v1's single-blob `vault` store is dropped after migration; `envelope` becomes per-device records; new stores: `records` (per-identity ciphertext), `node` (iroh SecretKey + doc id/capability for re-import on launch, per S1). One DB, one origin. iroh-docs itself stays memory-only in the session; the mirror is what survives reloads.
- **All prefs stay local** — theme (dark-only anyway) and autoLockMinutes are per-device; no settings records in the doc.
- **Migrated DEK = device A's DEK; re-enroll runs the normal S3 two-phase rotation** (both wraps → re-encrypt A's records → drop old wrap). No legacy re-enroll path: a migrated single-DEK *is* the first device's DEK, and a device that hasn't joined a sync yet behaves exactly like a synced one with no peers.
