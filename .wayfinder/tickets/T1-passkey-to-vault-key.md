---
id: T1
title: Pass-key-to-vault-key unwrap mechanism
type: research
status: closed
blocked_by: []
assigned:
---

## Question

How, exactly, does the passkey produce the symmetric key that decrypts the local vault on the Ikko Mind One's browser (target: modern Chrome on Android)?

Options being weighed:
- WebAuthn **PRF extension** (a.k.a. HMAC-Secret) deriving a fixed per-credential HMAC key from the passkey — allows "threading" vault encryption keys.
- A **signed challenge** unwrap: vault stores a blob encrypted with a random key; the passkey signs a challenge; server-less client unwraps using the attestation/assertion signature or a stored wrapped key.
- **Fallback when PRF is unsupported**: e.g. re-typed recovery code, or wrapping with a second WebAuthn key.

Requirement from the human: passphrase typed on every launch is the *Spectre secret* (derives site passwords), and is **never persisted**; passkey does NOT replace it directly.

## Resolution

Closed 2026-08-10 · full report: `.wayfinder/research/T1-passkey-to-vault-key.md`.

**Use WebAuthn PRF extension** (CTAP2 hmac-secret). `get()` with `extensions.prf` returns a deterministic 32-byte per-credential output; HKDF → AES-GCM gives the vault key. Fully offline/serverless on Chrome Android ≥130 (stable, no flags). **Not usable**: assertion signatures, authenticatorData, public keys.

**Envelope encryption required** (Cappalli warning): wrap a random per-vault DEK under each passkey's PRF output, plus a typed **recovery code** as second unwrap path. PRF is bound to one credential — losing it loses the key.

Caveats: secure context (https), top-level document only (no WebView/TWA), rpId must match the final domain, resident/discoverable credential for username-less login.