# S4 — iroh-in-Vite spike (prototype asset)

**Date:** 2026-08-13 · **Status:** Toolchain proven; live record-sync over the relay not yet closed · **Crate:** `crates/spectre-sync` · **Spike page:** `spike.html` (+ `src/spike.tsx`)

## What was built

A minimal wasm wrapper crate over `iroh` 1.0.3 + `iroh-docs` 0.101 + `iroh-blobs` 0.103 + `iroh-gossip` 0.101, exposed to JS via `wasm-bindgen`, bundled into this Vite + SolidJS 2 PWA, and driven from a two-tab spike page (`?tab=A` = creator/sender, `?tab=B` = joiner/receiver; ticket passed via localStorage).

Wrapper API (`SyncNode`): `start()` (bind + full protocol router), `create_doc()`, `import_ticket()`, `doc_id_from_ticket()`, `set()`, `get()`, `subscribe()`, plus diagnostics `node_id()`, `relay_status()`, `ticket_info()`, `remote_info()`, `connect_docs()`.

## Verdict

| Claim | Result |
|---|---|
| **Build pipeline** — wasm32 + wasm-bindgen inside Vite, main thread | ✅ **Proven.** `cargo build --target wasm32-unknown-unknown` + `wasm-bindgen --target web`; the `.js`/`.wasm` load via `new URL(..., import.meta.url)` in a plain Vite multi-page entry. No dedicated worker needed — iroh runs on the main thread via `wasm-bindgen-futures` (`spawn_local`). Works alongside `generateSW` PWA. |
| **Endpoint + relay** — bind, connect to n0 public relay | ✅ **Proven.** `Endpoint::builder(presets::N0).alpns([...]).bind()`; `relay_status()` shows `https://euc1-1.relay.n0.iroh.link./ connected=true`; relay `/ping` and pkarr DNS publishes observed in the network log. |
| **Doc lifecycle** — create, export ticket, import from second tab, subscribe | ✅ **Proven.** `create_doc` → `DocTicket`; second tab `import_ticket` → same doc id on both tabs; `subscribe` attaches. |
| **Browser-to-browser relay dialing** | ✅ **Proven.** My node B dialed the **official n0 browser-echo demo** and got a real protocol error (`peer doesn't support any known protocol`) — proving QUIC + relay transport works across tabs. My B also dialed my A: `connect_docs(peerId)` returned A's endpoint id. |
| **Sync a record E2E over the relay** | ⚠️ **Not closed.** After B imports the ticket and starts sync, the docs engine's record exchange does not complete (`sync_peers: (none)`, no `InsertRemote` event). Transport dial works; the docs *sync handshake* over that connection does not deliver. Needs a follow-up ticket (likely an iroh-docs 0.101 wasm edge in the docs protocol over relay, or a config detail in how the docs engine dials peers). |
| **Cost** | **Release + wasm-opt = 7.1 MB** wasm (debug 27 MB). Gzip estimate ~1.5–2 MB. Significant for a small-screen PWA; the wasm loads only on the sync path (spike entry is a separate Vite input, not the main bundle). |

## Build path (pinned, matches S1 + n0 browser-echo)

```toml
# .cargo/config.toml
[target.wasm32-unknown-unknown]
rustflags = ['--cfg', 'getrandom_backend="wasm_js"']
```

```toml
# Cargo.toml essentials
iroh = { version = "1", default-features = false, features = ["tls-ring"] }
iroh-blobs = { version = "0.103", default-features = false }
iroh-docs = { version = "0.101", default-features = false }
iroh-gossip = { version = "0.101", default-features = false }
getrandom = { version = "0.3", features = ["wasm_js"] }
wasm-bindgen = "0.2.122"
```

```sh
# ring needs a wasm-capable clang: brew llvm@21 (not Apple clang)
CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm@21/bin/clang \
AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm@21/bin/llvm-ar \
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir wasm-out target/.../spectre_sync.wasm
wasm-opt --enable-nontrapping-float-to-int --enable-bulk-memory -Os -o out.wasm ...
```

## Hard-won runtime gotchas (verified)

1. **Wait for the relay connection, not just an address.** `Endpoint::addr()` gains a relay URL before the WebSocket connects. `share()` with `AddrInfoOptions::Id` (default) embeds only the node id and relies on pkarr; `RelayAndAddresses` embeds the relay URL directly. To have a dialable ticket, wait for `home_relay_status()` → `is_connected()` (an `online()`-style bounded loop) before sharing.
2. **Advertise your ALPNs.** `Endpoint::builder(presets::N0)` alone does **not** advertise the docs/gossip ALPNs. Without `.alpns([blobs, gossip, docs])`, inbound docs connections fail the handshake silently and the peer dial times out. This was the blocker that made "connect_docs → A" time out.
3. **Memory-only stores.** As S1 predicted: no IndexedDB docs store; doc + authors + endpoint `SecretKey` all vanish on page close. Persistence is still S6's job.
4. **Two endpoints in one page is not a valid test.** The reference example and the working dials all use one endpoint per tab. Same-page double `bind()` is not representative.

## Open item

Getting the docs engine to complete a record sync over the browser relay path. The transport is proven; the missing piece is the docs-protocol sync handshake. Recommended next: a focused test against the upstream `iroh-docs` wasm tests / issue tracker, or wiring `gossip.join` + `sync_with_peer` explicitly and observing `LiveEvent::SyncFinished`.

## Spike files

- `crates/spectre-sync/` — wrapper crate (Cargo.toml, src/lib.rs, .cargo/config.toml)
- `crates/spectre-sync/wasm-out/` — generated bindgen JS + wasm (debug)
- `src/lib/spike/spectre_sync.{js,wasm,d.ts}` — copied into the Vite app
- `spike.html` + `src/spike.tsx` — two-tab spike page
- `vite.config.ts` — adds `spike` as a second build input
