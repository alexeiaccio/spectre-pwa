---
id: S6
title: Vault-store migration to iroh-docs
type: grilling
status: open
blocked_by: [S1, S2, S3]
assigned:
---

## Question

With iroh-docs as the primary store, what happens to existing v1 installs?

- **Migration**: v1 IndexedDB (DB `spectre-pocket` v2: one envelope + one ciphertext blob) → per-record doc: in-place migration on upgrade, or fresh re-setup?
- **Persistence**: does iroh's browser store live in IndexedDB itself (see S1) or a separate persistence layer — does the app keep one DB or two? Does the v1 DB/version story change?
- **Re-enroll**: v1 re-enroll (T4) rotates a shared DEK and re-encrypts the blob; with per-device DEKs, re-enroll becomes "rotate my DEK, re-encrypt my records" — what breaks, what survives?
- **prefs**: theme + autoLockMinutes — synced or stay local?
