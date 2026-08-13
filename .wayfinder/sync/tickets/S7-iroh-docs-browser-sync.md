---
id: S7
title: iroh-docs browser record sync — why the sync handshake never delivers
type: prototype
status: open
blocked_by: [S1, S4]
assigned: dev
---

## Question

S4 proved the toolchain (build pipeline, relay connection, doc lifecycle, and browser-to-browser **transport dialing** all work) but the docs **engine** never completes a record sync over the relay: after `import_ticket` + `start_sync`, `sync_peers` stays `(none)` and no `InsertRemote`/`SyncFinished` events arrive. Isolate why, and get one key-value record to flow A→B over the n0 public relay.

## What is already proven (S4)

- `Endpoint::builder(presets::N0).alpns([blobs,gossip,docs]).bind()` → `relay_status() = connected=true` (WebSocket to `euc1-1.relay.n0.iroh.link.`).
- Doc create → `DocTicket` (with `RelayAndAddresses`), second tab `import_ticket` → same doc id, `subscribe()` attaches.
- **Transport dialing works across tabs:** my node dialed the official n0 browser-echo demo and got `peer doesn't support any known protocol` (real handshake reached the peer), and `connect_docs(peerId)` returned the remote's endpoint id.
- So: relay transport ✅, endpoint dialing ✅, doc API ✅. The gap is inside the docs sync engine's connection handling.

## Hypotheses to test (in order)

1. **Address-book seeding at dial time.** The engine's `sync_with_peer` dials `EndpointAddr::new(peer)` — no relay URL — relying on address lookup. `join_peers` does `memory_lookup.add_endpoint_info(peer)` from the ticket, but only if the ticket node was non-empty; verify the lookup actually resolves the relay before the dial fires.
2. **The docs-ALPN connection must be *held* and *recognized*.** My `connect_docs` established a docs-ALPN connection but the engine didn't use it. Does the docs engine require `gossip.join(namespace, peers)` to be called with the peers *before* the connection exists, and does it then need the docs protocol to receive the connection on the Router (vs. a raw endpoint dial)?
3. **Ordering / lifecycle.** `start_sync` sends an RPC to the live actor; if the Router or gossip task isn't polling in wasm (spawned but not driven), the join never completes. Compare with how `spawn_local`-driven tasks behave; try `import_and_subscribe` (starts sync before subscribing) and `Doc::start_sync` explicitly after the dial.
4. **Two docs-ALPN connections direction.** Docs sync may need BOTH sides to dial (A must also connect to B). Try having A `connect_docs` to B after B joins.
5. **Upstream known issue.** iroh-docs 0.101 wasm support is very new (merged Feb 2026, no wasm CI job per S1). Check iroh-docs issues/PRs and the `wasm_test` in n0's CI for a docs-sync-in-browser caveat before deep-diving the wrapper.

## Deliverable

A prototype asset (extend the S4 spike or a focused new page) that closes with `B RECEIVED: <value>` after `A: send`. Update this ticket with the root cause and the fix (wrapper config vs. upstream bug). If it turns out to be an upstream wasm limitation, record the workaround or explicitly rescope sync to native clients with the browser as read-only.

## Acceptance

- Two tabs (or tab + CLI, see S1) exchange one record through the n0 relay.
- Root cause documented in this ticket.
- Decision: wrapper-side fix (landed in `crates/spectre-sync`) or upstream issue filed + workaround scoped.
