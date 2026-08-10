---
id: T2
title: Vault storage engine and schema
type: prototype
status: open
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

(pending)