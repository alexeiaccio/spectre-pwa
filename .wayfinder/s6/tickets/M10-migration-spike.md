---
id: M10
title: Migration spike — v2 blob → v3 records on real IndexedDB
type: prototype
status: out_of_scope
blocked_by: [M3, M4]
assigned: dev
---

> **OUT OF SCOPE (2026-08-15):** dropped with M4 — no users, no migration. The spike's recipe is history.

## Question

A throwaway run-through that validates M4's step order + crash-safety against real IndexedDB before M7 commits to it:

- Fixture: a v2 envelope + blob (built with the current `vaultImpl.setup` on a v2 DB) → run the migration steps → assert the v3 stores hold correct records under A's DEK, the v1 blob is dropped, and unlock works after.
- Deliberately interrupt the migration mid-way and assert the recovery path (re-runable, no silent loss) — exercises the commit point M4 defines.
- Land on a throwaway branch/scratch; link the prototype as an asset from this ticket. Iterate with the human until the step order feels right; M4's spec reflects it.

## Resolution

Landed as `tests/browser/migration-spike.test.ts` (browser project, real IndexedDB + CDP virtual authenticator for the v2 fixture). **3/3 green.**

- **Recipe validated** (recovery path): unwrap A's DEK from the v2 envelope → decrypt the v1 blob → split into per-identity records re-encrypted under A's DEK (`writer: deviceId`) → write v3 `records`/`envelope`/`meta` → **commit = `meta.migrated`** → clear v1 `vault` + envelope `root`.
- **A's v3 envelope reuses the v2 wraps unchanged** (they wrap the same DEK — matches S6 "migrated DEK = A's DEK").
- **Crash-safety proven**: an interrupted run (records written, no commit) leaves `meta.migrated` unset + the v1 blob intact; the next run completes idempotently.
- Findings for M7: the v3 `SpikeRecord` shape (v2/kind/writer/iv/ct) is the live `SyncRecord` type to land in schema.ts; the DB upgrade must create `records`/`node`/`meta` and keep the v1 stores until commit; the migration test needs the CDP authenticator because the v2 fixture uses real passkey setup.
