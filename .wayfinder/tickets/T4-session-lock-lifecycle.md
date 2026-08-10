---
id: T4
title: Session and lock lifecycle (passphrase-on-launch UX)
type: grilling
status: closed
blocked_by: []
assigned:
---

## Question

The human chose: passphrase on **every app launch**, unlocked for the session's duration, no per-generation prompts. Pin down the concrete lifecycle:

- What is "launch" exactly for an installed PWA — cold start, or also return-from-background? Auto-lock timer?
- Passphrase is the Spectre *secret*; full-name is per-identity. After unlock, does the app derive `master-key` once and hold it in memory, or re-derive per site?
- Lock action (explicit "lock" button + hide app from recents) must also wipe in-memory derived keys — enumerate the wipe points.
- Relationship between passkey unlock (vault metadata) and passphrase unlock (identity secret): can you open an identity's saved sites without the passphrase? Does the identity picker require passkey first?

## Resolution

Closed 2026-08-10 · full report: `.wayfinder/research/T4-session-lock-lifecycle.md`.

Two gates, one wipe model:
- **Gate 1 passkey** → unlocks encrypted vault → identity list + saved site *names* browsable.
- **Gate 2 passphrase** → derives `masterKey = scrypt(...)` ONCE per identity session, held as non-extractable HMAC `CryptoKey`; per-site = cheap `subtle.sign`. Never re-derive scrypt per site.
- **"Launch" = every foregrounding.** Boot locked. Detect via visibilitychange/resume/pageshow; grace ≈2 min since `hidden`, else lock. Use timestamps, not hidden setTimeout.
- **Lock = full re-auth** (passkey→biometric→passphrase), no biometric-grace tier possible in a web app.
- **Wipe points:** manual lock button, visibilitychange→hidden (also blanks recents thumbnail), freeze, pagehide/beforeunload (best-effort), grace-expired resume, clipboard auto-clear ~30s.
- **Honest note:** strings (the passphrase) can't be wiped in JS — immutable, GC-level. Minimize raw-byte lifetime, hold long-lived CryptoKey handles, zeroize owned Uint8Arrays; document as hygiene not guarantee.
- Identity switch mid-session re-prompts only if the new identity has its own secret; previous master key wiped at switch.