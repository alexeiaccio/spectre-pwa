---
id: GS5
title: Periodic cross-device sync
type: task
status: open
blocked_by: [GS1]
assigned:
---

## Question

Make shared identities **periodically converge across all group devices**
without cross-device passphrases — now possible because records encrypt under
the group key K (GS1).

## Design sketch

- With K, any device can decrypt any group record, so the inbound/outbound
  bridge (`bridge.ts`) works against K rather than per-writer DEKs:
  - outbound: local edits → re-encrypt under K → write to doc
    (`pushSave`), refresh the host pointer.
  - inbound: poll the doc's identity keys and merge under K (`syncNow`),
    LWW by v1 uuid as today.
- **Triggers**: on app open / foreground (`visibilitychange` + `online`), on
  the identities screen, and a periodic in-app timer while open (relay-side
  keepalive is a separate iroh-worker follow-up; in-app timer covers it).
  (Small window with `.wayfinder/sync-bg/`'s queue-and-flush recommendations.)
- Resolve/write the doc write-back for a joiner's own identities (ties GS3).
- **Status UX**: last-synced-at, pending changes, relay reachability.

## Acceptance

- Two devices edit different identities; after a sync each sees the other's (no
  passphrase involved).
- LWW conflicts resolve deterministically; a device's delete (tombstone)
  propagates.
- Status surface reflects synced/pending/offline states.
