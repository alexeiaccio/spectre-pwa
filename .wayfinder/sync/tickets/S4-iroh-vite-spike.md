---
id: S4
title: Minimal iroh-in-Vite build spike
type: prototype
status: resolved
blocked_by: [S1]
assigned:
---

## Question

Prove the toolchain: two tabs/devices running this exact Vite + SolidJS 2 PWA exchange one key-value record over iroh through the n0 public relay.

- **Build pipeline**: wasm-pack/wasm-bindgen inside Vite; wasm + js module wired into the bundle; worker placement (main thread vs dedicated worker — does iroh's async want a worker?); interplay with the existing `generateSW` PWA + `virtual:pwa-register`.
- **Runtime check**: start endpoint, create doc, export capability, join doc from a second tab, sync a record, confirm the relay path is exercised and traffic is E2E-encrypted.
- **Cost**: bundle size + startup latency on a small device.
- Deliver the spike as a prototype asset linked from this ticket.

## Resolution

Full prototype asset: `.wayfinder/sync/research/S4-iroh-vite-spike.md` (2026-08-13). Wrapper crate at `crates/spectre-sync`, spike page at `spike.html`.

**Verdict — toolchain proven; live record-sync over the relay still open.**

- ✅ **Build pipeline:** wasm32 + wasm-bindgen inside Vite, main-thread (no dedicated worker), coexists with `generateSW` PWA. `CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm@21/bin/clang` (ring; Apple clang lacks wasm target) + `.cargo/config.toml` getrandom rustflag.
- ✅ **Endpoint + relay:** `Endpoint::builder(presets::N0).alpns([blobs,gossip,docs])`; `relay_status` shows `connected=true`; relay `/ping` + pkarr publishes observed.
- ✅ **Doc lifecycle:** create → ticket, import from a second tab, subscribe — all work; same doc id on both tabs.
- ✅ **Browser-to-browser relay dialing:** my node dialed the official n0 browser-echo demo (got a real protocol error — transport works) and dialed my other tab (`connect_docs` → remote id returned).
- ⚠️ **Record sync not closed:** after `import_ticket` + `start_sync`, the docs engine never delivers (`sync_peers: (none)`, no `InsertRemote`). Transport dial works; the docs-protocol sync handshake over it does not complete in iroh-docs 0.101 wasm. **Follow-up needed** (new ticket): likely an iroh-docs wasm edge in docs-over-relay sync, or a wrapper config detail. Transport is proven, so this is scoped to the docs engine layer, not the toolchain.
- **Cost:** release + wasm-opt = **7.1 MB** wasm (debug 27 MB), gzip ≈1.5–2 MB. Loaded only on the sync path (separate Vite input, not the main bundle) — but too big to ship inline; code-split / lazy-load, and revisit with wasm-opt `-O3` + `lto`.

**Key gotchas found:** (1) wait for the relay WebSocket to be *connected* before sharing a ticket — a configured-but-unconnected relay makes peer dials time out; (2) advertise ALPNs on the endpoint builder or inbound docs connections fail the handshake silently; (3) memory-only docs store confirmed (S1), persistence still S6.
