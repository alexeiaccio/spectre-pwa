---
id: GS5
title: Periodic cross-device sync
type: task
status: closed
blocked_by: [GS1]
assigned: dev
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

## Resolution

Closed 2026-08-18.

- **Triggers** (`src/lib/sync/sync-runner.ts`): app-open, in-app timer (30s),
  `visibilitychange` → visible, `online`; gated on `document.hidden`, while
  unlocked & after a doc is joined, and single-flight. `useSyncRunner` wired in
  `src/app.tsx`.
- **One pass = inbound** (`syncNow` doc→mirror, LWW resolved by doc, records
  under K) **+ outbound** (diff against the bridge's confirmed-push watermark →
  `pushChanges` under `session.dek`=K + host-pointer refresh; write-on-change,
  no ping-pong). Local deletes propagate as tombstones. `bridge.ts` gains the
  outbound watermark + exports `updateHostPointer`.
- **Status** (`src/lib/sync/sync-status.ts`): `lastSyncedAt`, `pendingChanges`
  (local not-yet-confirmed pushes; >0 while relay down until the next pass
  succeeds), `relayReachable`, `syncing`. Reactive via `syncStatus()` /
  `useSyncStatus()`.
- Caveat: inbound merges land in the mirror, so foreign identities surface
  after reload/re-unlock (live in-session UI refresh is GS6/subscribe work).
- 6 new runner tests; integrated 120/120 green, tsc clean.
  (Two Solid-2-beta one-arg `createEffect` crashes found and fixed during
  integration.)
