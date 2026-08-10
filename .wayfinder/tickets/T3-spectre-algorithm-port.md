---
id: T3
title: Spectre algorithm port scope (V0–V3) and reference
type: research
status: closed
blocked_by: []
assigned:
---

## Question

Which algorithm versions must the TS port produce bit-identically to the reference C implementation, and where does the authoritative reference + test vectors live?

Issues:
- The web repo's `spectre-service.js`/`spectre-types.js` are a close JS port — do they match the C reference on all four versions (2012:03, 2012:07, 2014:09, 2015:01)?
- Confirm SCRYPT + HKDF parameters per version, the site-purpose scoping (`siteSecurity`, `code`, `answer`), password templates, and identicon inputs.
- Establish a test-vector corpus to lock the port (samples from official algorithm PDF, or generated from C CLI).
- Whether to keep multi-version support in v1 UI or gate by version.

## Resolution

Closed 2026-08-10 · full report: `.wayfinder/research/T3-spectre-algorithm-port.md`.

**Source of truth: `spectre.app/web` `js/spectre/spectre-algorithm.js`** (NOT the android repo — that's old Java UI). Spectre ⇔ Master Password are **bit-identical** (same `com.lyndir.masterpassword` scopes); V0–V3 all use `scrypt(N=32768,r=8,p=2,dkLen=64)` + HMAC-SHA-256 site key, **no HKDF anywhere**. Versions differ only by length-field encoding + V0's 16-bit quirk.

**60/60 official vectors verified** in an independent Node impl (incl. `Jejr5[RepuSosp`, snowman ⛄ multibyte cases). Ready-to-paste TS test in report.

Browser scrypt: **`@stablelib/scrypt`**. TS port layout: `src/lib/spectre/{spectre-types,spectre-algorithm,scrypt}.ts` + `.test.ts`. Default version 3, implement 0–3.