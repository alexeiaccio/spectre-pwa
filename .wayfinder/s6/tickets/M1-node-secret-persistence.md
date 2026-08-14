---
id: M1
title: iroh node secret-key persistence feasibility
type: research
status: closed
blocked_by: []
assigned: dev
---

## Question

The iroh browser store is memory-only (S1): the node's SecretKey, the doc capability, and author keys must be persisted ourselves and re-imported on launch. Collect the facts M6 (node mirror semantics) and M9 (crate change) need:

- (a) Read `crates/spectre-sync/src/lib.rs` — how is the node created (`Endpoint::builder(...).bind()`)? Does `SyncNode.start()` expose or accept a SecretKey, or is there an export/import API?
- (b) In iroh 1.0 (and iroh-docs 0.101), what does the docs `DocStore`/`MemoryStorage` require to survive a restart — what must we persist (SecretKey bytes, doc id, author key) and re-import (e.g. `DocTicket::deserialize`, an endpoint from a known secret)?
- (c) What `crates/spectre-sync` changes are needed to support "create node from a persisted SecretKey" (or "export the SecretKey")? Estimate the wasm-bindgen surface.
- (d) Does `join_and_sync`/`create_doc` keep working across a reload if only the SecretKey + DocTicket are re-imported?

Write findings to `.wayfinder/s6/research/M1-node-secret-persistence.md`. Cite versions and sources. This feeds M6/M9 — do not implement.

## Resolution

Findings at `research/M1-node-secret-persistence.md`. **Feasible and low-cost.**

- Node identity = `SecretKey.public()`; persist **32 bytes** (`to_bytes`/`from_bytes`, iroh-base 1.0.3), restore via `Endpoint::builder().secret_key(...)`. iroh mints a fresh random key per `bind()` today (that's the "node id changes every reload" gap).
- `Endpoint::secret_key()` exposes export trivially. Doc re-attach = parse `DocTicket` (embeds Write capability + addrs) → `docs.import(ticket)` — the existing `import_ticket`/`join_and_sync` already do this.
- **Authors**: not required for correctness; a new random default author is minted each spawn in memory mode — persist only if author identity stability matters. App `deviceId` is already decoupled (`crypto.randomUUID()`), so node-id instability doesn't corrupt envelope keys.
- **Recommended wasm surface** for M9: `start_with_secret_key(hex)`, `export_secret_key()`, optional `export_default_author()`/`import_default_author(hex)`; keep `start()` + existing methods untouched. Versions pinned: iroh 1.0.3, iroh-docs 0.101.0.
