---
id: S5
title: Pairing and first-run UX on tiny screens
type: grilling
status: closed
blocked_by: []
assigned: dev
---

## Question

The join flow as UX on the small portrait screen (Ikko Mind One):

- **Device A**: where the QR + invitation string screen lives within the existing ≤2-level nav (settings screen?), capability refresh cadence, copy affordance.
- **Device B**: scan/type → recovery-code prompt → sync → re-encrypt into DEK-B → passkey enrollment. Order and error states (bad code, relay unreachable, doc has no write access).
- **Trust**: joining grants write capability — B can clobber A's vault via LWW. Is that accepted? Revocation is out of v1?
- **First-run branching**: brand-new install (v1 flow) vs "start the pair" (new sync doc) vs "join a sync" (scan/invite) — where does the user choose?

## Resolution

- **First-run branch**: keep **Create vault** as the primary CTA on the needs-setup screen (unchanged v1 form); add a secondary link below it — **"I have a vault on another device — join it"**. No separate chooser screen. Creating a vault *is* "starting the pair" (the new doc + envelope exist from that moment); pairing UI is reachable from the unlocked state, not a special create-path.
- **Join availability**: **existing vaults can join too**, not just fresh installs. A locked vault (or needs-setup) offers the join link. Two independent vaults merging is in scope and resolves per below.
- **Existing-vault join adopts the host's code**: B keeps its DEK and identity records, but at join types A's recovery code, **re-wraps DEK-B under A's code** (dropping B's old code wrap), then syncs its identities into A's doc. One vault, one code preserved; B's old code stops working. On a fresh-install join, there is no old wrap — the typed code simply becomes B's recovery wrap.
- **Merge semantics**: identities merge **by v1 uuid**; a uuid present on both sides resolves by whole-record LWW (silent, per S2). No collision refusal path.
- **Code prompt timing (device B)**: scan/type invitation → sync doc (envelope + records arrive) → **then** prompt recovery code, **verified by unwrapping the host device's envelope** → then re-encrypt records under DEK-B / re-wrap DEK-B → then **passkey enrollment**. Wrong code detected before any re-encrypt/passkey step, against real data.
- **Pairing screen on device A**: a **"Sync with another device" dashed section on the identity-picker level** (alongside Add identity / Re-enroll / Auto-lock) → opens QR + invitation string. No new nav level. QR-encodes the iroh `DocTicket` string; a "copy invitation" affordance provides the string fallback. Capability shown is stable while the session lives; refresh after re-enroll/DEK rotation (the doc ticket itself doesn't change, but show current).
- **Error states**: bad recovery code → "wrong recovery code" after verified unwrap; relay unreachable → retryable sync status (no hard failure — offline is a valid state per v1's offline-first; sync just waits); join without write access → not applicable (ticket we issue is always Write), but if import fails, show "invitation rejected".
- **Trust**: joining grants Write capability — B can clobber A's vault via LWW. **Accepted** (S3); no revocation in sync v1.

## Implementation status (2026-08-14)

Landed per the resolution, built on the routing seam (`.wayfinder/routing/` — `{ view: 'join' }` union case, `/join` route):

- **`src/lib/sync/`** — the adapter seam + protocol:
  - `records.ts` — pure join protocol (S3): `unwrapRecoveryDek`/`verifyRecoveryCode` (code verified against the host's real envelope), `encode/decodeIdentityRecord`, `reencryptUnderDekB` (unwrap host DEK → decrypt → fresh DEK-B wrapped under code + passkey PRF → re-encrypt records). **Unit-tested** (`tests/unit/sync-join.test.ts`, 4 tests).
  - `types.ts` — doc key model: identity records by uuid, device envelopes under `env/<deviceId>`, plus a **host pointer** (`host` → deviceId + identityIds) since the wasm API has no key-list.
  - `adapter.ts` — experimental wasm adapter (`SyncNode`) behind a `SyncAdapter` interface, `SYNC_EXPERIMENTAL` flag per S7.
  - `pairing.ts` — device A: create doc, publish host pointer + A envelope + per-identity records under A's DEK, return the DocTicket invitation.
- **UI**: `JoinScreen` (invite → sync → recovery → enroll, internal steps, error states incl. wrong code / experimental-sync retry), "join it" links on setup + locked, **"Sync with another device"** pairing section on the identities screen (invitation + copy). `useVault.importJoined` completes a join locally (write envelope + blob under DEK-B, unlock).
- **Verified**: 67 tests, lint 0/0, format clean, build green; `/join` smoke-tested in a real browser.

**Follow-ups (not landed):**
1. **Existing-vault join** (adopt host's code, re-wrap DEK-B, merge by uuid per S5:22-24) — `/join` redirects to `/` when unlocked; locked shows the fresh-join path with a replace-vault warning.
2. **QR generation — LANDED (2026-08-15)** for the invitation (`uqr`, `QrCode` in `components/ui`), shown on device A's "Sync with another device" pairing section. **QR scanning — LANDED (2026-08-15)**: `/join` gains a Paste/Scan-QR toggle (`QrScanner` via `@zxing/browser`, rear-camera `facingMode: 'environment'`); a successful decode fills the invitation and starts the join automatically. Camera denied/unavailable → error state; scanning is not covered by automated browser tests (headless has no camera).
3. **PRF salt persistence — RESOLVED (2026-08-14).** The passkey `WrappedDeK` now carries `prfSalt` + `credId`; setup/re-enroll store them, and unlock re-derives the PRF output from the stored salt and **targets the stored credential** (`allowCredentials: [credId]`). This also fixed a latent bug: after a re-enroll, a usernameless `get()` could select the stale credential → wrong PRF → unlock failure. Verified end-to-end with `tests/browser/passkey-unlock.test.ts` (CDP virtual authenticator: setup→lock→unlock, and re-enroll→lock→unlock). The join flow records the same fields on B's passkey wrap.
4. **Node identity persistence** — `SyncNode.start()` doesn't accept a persisted SecretKey; the node id (and thus the doc capability) changes per reload until the durable-mirror re-import (S1/S6).
5. **A-side doc writes are a pairing-time snapshot** — identity edits don't push to the doc yet; that's the S6 record bridge.
6. **Live sync remains experimental** per S7 (upstream iroh-docs wasm reliability).
