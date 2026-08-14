---
id: M6
title: Node mirror + re-import semantics
type: grilling
status: closed
blocked_by: [M1]
assigned: dev
---

## Question

Pin how the `node` store drives the iroh node across reloads (S1: browser store is memory-only):

- **What to persist**: SecretKey, doc capability (DocTicket), author keys — exact `node` store keys and encoding, per M1's feasibility facts.
- **Re-import on launch**: the boot sequence (create node from persisted SecretKey → re-attach the doc → resubscribe); interaction with `useVault` boot and the migration (does a migrated vault create its doc then, or defer to the pairing section?).
- **Single doc vs multi-doc**: one sync doc per vault, or the pairing section creating docs ad hoc (current S5 behavior) — does the mirror pin a single doc?
- **Node identity stability**: does the persisted SecretKey give a stable node id, and what breaks if it's lost (re-pairing?).
- Deliverable: the node-mirror spec for M9 (crate) + M8 (bridge).

## Resolution

Confirmed by grilling with the human (2026-08-14). **Single persisted vault doc; author persisted too.**

- **One vault doc**: pairing and join both resolve to a single persisted doc capability in `node.doc` (DocTicket). Pairing: `createDoc` → persist `node.secret` (on first node use) + `node.doc` → invite. Join: `joinDoc` → persist `node.doc` → re-encrypt → write records. No ad-hoc docs after this.
- **Re-import on launch**: if `node.secret` → `start_with_secret_key(hex)` (stable node id, per M1's crate surface); if `node.doc` → re-import the ticket + resubscribe. `useVault` boot stays sync-agnostic; the re-attach runs when the app reaches the identities screen with a persisted doc (post-migration AND post-pairing).
- **Author persisted too** (`node.author`, 32-byte hex, per M1) so record edits keep a stable author identity across reloads. `node` store keys: `secret` / `doc` / `author`.
- **Stability**: persisted SecretKey → stable node id. If the mirror is lost (clear-site-data), the node id changes → peers can't find it → re-pairing; the mirror is the protection, accepted.
- Feeds M9 (crate: `start_with_secret_key`/`export_secret_key`/author import/export) + M8 (bridge wiring) + M7 (node store reads/writes).
