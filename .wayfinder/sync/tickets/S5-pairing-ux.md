---
id: S5
title: Pairing and first-run UX on tiny screens
type: grilling
status: open
blocked_by: [S2, S3]
assigned:
---

## Question

The join flow as UX on the small portrait screen (Ikko Mind One):

- **Device A**: where the QR + invitation string screen lives within the existing ≤2-level nav (settings screen?), capability refresh cadence, copy affordance.
- **Device B**: scan/type → recovery-code prompt → sync → re-encrypt into DEK-B → passkey enrollment. Order and error states (bad code, relay unreachable, doc has no write access).
- **Trust**: joining grants write capability — B can clobber A's vault via LWW. Is that accepted? Revocation is out of v1?
- **First-run branching**: brand-new install (v1 flow) vs "start the pair" (new sync doc) vs "join a sync" (scan/invite) — where does the user choose?
