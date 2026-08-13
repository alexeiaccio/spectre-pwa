---
id: T2
title: Vault storage engine and schema
type: prototype
status: resolved
blocked_by: [T1]
assigned:
---

## Question

Where does the encrypted vault live and what's its shape?

Candidates:
- **IndexedDB** (standard, async, transactional) vs **OPFS** (Origin Private File System, better for large blobs, has `navigator.locks` synergy).
- Schema: one object store per identity? A single store keyed by identity? Where do per-identity *full name*, *sites* (name, counter, type, login name, security answer), and *settings* live?
- What stays **plaintext** at rest (required to render the locked identity-picker) vs **encrypted**.
- Key/value layout compatible with future identity provisioning (import/export).

Output expected: a decision + a concrete IDB/OPFS schema to implement under the T1 unwrap key.

## Resolution

**Storage: IndexedDB** (not OPFS). Two object stores in DB `spectre-pocket` v1:
- `envelope` (key `root`) → `Envelope { version, deks: WrappedDeK[] }` — non-secret key-wrapping header: which keys can unwrap the DEK (passkey PRF-derived KEK, recovery-code KEK). Visible while locked; no secrets.
- `vault` (key `ciphertext`) → `VaultBlob { iv, ct }` — one AES-GCM-256 blob of the whole plaintext tree under the in-memory DEK.

**Encrypted-at-rest**: everything under the DEK — identity full names, site names, counters, templates, purposes, logins/answers.

**Plaintext-at-rest**: none beyond the envelope header. The locked identity-picker requirement from the map was dropped — T4's lock screen shows only "unlock with passkey / recovery code", no identity names, so nothing user-visible needs to be plaintext.

**Crypto shape** (from T1): DEK random 32B (non-extractable, transient raw wiped after wrapping) → HKDF-SHA-256(PRF-output | recovery-code, per-KEK random salt) → AES-GCM-256 KEK → `wrapped = AES-GCM(KEK, raw DEK)` stored per record in `envelope.deks`. Blob encryption: AES-GCM with fresh random IV per save.

**Recovery-code format**: v1 = user-chosen string, any length ≥ 8 chars (UI validation only). No scheme/KDF change needed since KEK derivation is already HKDF over arbitrary bytes; a future passphrase-style code slots in unchanged.

**Layout rationale**: single blob per vault (not per-identity stores) keeps the DEK envelope trivially consistent and makes future import/export a single blob copy; per-identity granularity buys nothing when the whole tree must be unwrapped to render anything.

**Implementation**: `schema.ts`, `storage.ts`, `crypto-dek.ts`, `service.ts`, `passkey.ts`, `useVault.ts`, `App.tsx`. Crypto roundtrip covered by `tests/crypto-dek.test.ts` (`npm test`).

Status → **resolved**.