---
id: S7
title: iroh-docs browser record sync — why the sync handshake never delivers
type: prototype
status: closed
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

## Resolution (2026-08-13)

Investigation complete; wrapper-side fixes exhausted. Verdict: **docs-over-relay sync in the browser build is real but unreliable in iroh-docs 0.101 wasm** — it worked once (`B: RECEIVED: hello-from-A-…` + `B: SYNC:ok sent=0 recv=1`), and failed every subsequent attempt with `SyncFinished → "Failed to establish connection"` regardless of the mitigations below. Recorded as an upstream-dependency risk; sync-in-browser stays **experimental** until iroh-docs wasm matures or a native client carries the sync.

### What was proven during the investigation

- **Relay transport is not the problem.** `connect_peer` (dial the ticket's peers using their embedded relay URL, hold the docs-ALPN connection) succeeds **reliably** (`connected 1 peer(s)`), whereas dialing a bare node id (`EndpointAddr::new(id)`, relying on pkarr lookup) is flaky and usually times out. So: relay WS up ✅, relay-address dialing ✅, docs ALPN negotiated ✅, doc imported + subscribed ✅.
- **The docs engine's sync dial is the unreliable part.** `Doc::start_sync(ticket.nodes)` fires `sync_with_peer` → `connect_and_sync` which dials `EndpointAddr::new(peer)` (bare, pkarr-dependent) and runs the `/iroh-sync/1` codec. It emits `SyncFinished` with `result: Err("Failed to establish connection")` most of the time. The engine DOES seed its `memory_lookup` (registered onto the endpoint's lookup chain at spawn, `engine/live.rs:199`) from the ticket, so the bare-addr dial *should* resolve — but in wasm it does not reliably.
- **Holding a docs-ALPN connection does not fix it.** `connect_peer` + `connect_docs` establish and hold a live docs connection to A, but the engine's `connect_and_sync` dials its *own* connection and still fails. Retrying `start_sync` in a loop (8× over ~16 s) after the relay connection exists did not make it deterministic.
- **One success observed** (`SYNC:ok sent=0 recv=1` + `RECEIVED`) — so the codec path itself is not broken; the browser relay dial that feeds it is nondeterministic in this build.

### Fixes landed in the wrapper (retain as best-effort)

- `Endpoint::builder(...).alpns([blobs, gossip, docs])` — advertise ALPNs or inbound docs connections fail the handshake silently (this fixed the "connect_docs → A timed out" blocker).
- `ensure_online()` — wait for `home_relay_status` `is_connected()` (not just a configured relay URL) before sharing tickets.
- Share tickets with `AddrInfoOptions::RelayAndAddresses` so peers embed their relay URL (bare-id tickets force pkarr lookup, the flaky path).
- `connect_peer` / `join_and_sync` — dial peers by their relay address (reliable) and retry `start_sync`.

### Recommended next step

This is an **upstream iroh-docs wasm issue**, not a wrapper misconfiguration (the wrapper now does the "right" thing: advertise ALPNs, hold relay-addressed connections, wait for relay-up, retry). File/query an upstream issue on `n0-computer/iroh-docs` for browser sync reliability (the S1 note "no wasm CI job" is the smoking gun), and meanwhile **rescope v1 sync**: browsers join/read via the docs API and push through a native (Node/CLI) relay-side participant, or keep browser sync behind a feature flag. Do not ship browser-to-browser live sync on iroh-docs 0.101.

## Acceptance

- [x] Root cause documented in this ticket.
- [~] Two tabs exchange one record — **observed once** (`RECEIVED` + `SYNC:ok sent=0 recv=1`); not reproducible deterministically.
- [ ] Decision: wrapper-side fix — **landed but insufficient** (`crates/spectre-sync`: ALPN advertisement, relay-address dialing, relay-up wait, retry). Upstream issue needed; see "Recommended next step".
