---
id: M5
title: Record bridge — local edits to the doc, incoming records to the mirror
type: grilling
status: closed
blocked_by: [M3, M6]
assigned: dev
---

## Question

Pin the record bridge (the S5 follow-up "A-side live writes" + incoming merge):

- **Outbound**: after any local vault edit, push the changed identity's record to the sync doc — re-encrypted under **this device's DEK** (S3: rewrite only on content change, fresh random IV). Which writes trigger a push (add/edit/delete identity, site CRUD); batching/debounce; delete = tombstone or rewrite (S2)?
- **Inbound**: incoming records merge into the mirror by **v1 uuid, whole-record LWW** (S2, silent); re-encrypt under the local DEK only on content change (S3); how the `migrating`→`identities` hand-off exposes "your vault changed on another device".
- **The pairing-time snapshot → live-write transition**: the S5 pairing section currently writes a one-time snapshot (`shareVaultDoc`); does the bridge replace it or coexist?
- **Feature flag**: all of it behind the experimental-sync flag (S7) with the banner.
- Deliverable: the bridge + merge spec for M8.

## Resolution

Confirmed by grilling with the human (2026-08-14).

- **Schema refinement**: `SyncRecord` gains **`writer: deviceId`** (M3's type updated) so the merge can find the decrypting envelope. Both mirror + doc carry it.
- **Outbound**: every successful save pushes the changed identity's record — re-encrypted under **this device's DEK** (`writer: thisDevice`), fresh random IV; delete identity → **tombstone**; delete site → record rewrite. Immediate (no debounce — each save is a discrete user action).
- **Inbound**: records stored **as received** (under the writer's DEK); re-encrypt under our DEK **only on our own edit** — never on a received record (S3, no ping-pong). Decrypt lazily at read via the writer's envelope + recovery code.
- **Pairing**: `shareVaultDoc` stays as the *initial* write (create doc + push all records once, with `writer: A`); the bridge takes over thereafter.
- All behind the experimental-sync flag + banner.
- Feeds M8 (bridge implementation).
