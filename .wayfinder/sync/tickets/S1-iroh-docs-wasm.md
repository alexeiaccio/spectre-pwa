---
id: S1
title: iroh-docs in the browser — wasm feasibility
type: research
status: closed
blocked_by: []
assigned: research subagent
---

## Question

Can a Vite + SolidJS 2 browser PWA use **iroh-docs** as its sync store of truth, as of iroh 1.0 (stable, June 2026)? Establish:

1. **Wasm build**: does `iroh` (with docs feature) compile to `wasm32-unknown-unknown` via wasm-bindgen with `default-features = false`? Exact current build path (wasm-pack vs wasm-bindgen-cli), feature flags, and any known browser caveats.
2. **Docs store in browsers**: does the iroh-docs store persist across page close in a browser — what backend does the browser build use (IndexedDB, localStorage, memory-only)? This decides whether "iroh-docs primary" is viable for an offline-first app that closes and reopens.
3. **Connectivity**: browser nodes connect via WebSocket to a relay; confirm the n0 public relay default URL, how to configure/override it, and that traffic is E2E-encrypted (relay sees nothing).
4. **Sync primitive**: the doc invitation — doc id + capability export/import. Exactly what a second device needs to join a doc with read+write access; per-key set reconciliation and LWW semantics.
5. **Packaging**: official NPM package, or must we compile our own wasm wrapper crate (as iroh docs currently recommend)? Bundle-size / load-time expectations if known.

Deliver findings as a research note at `.wayfinder/sync/research/S1-iroh-docs-wasm.md`, citing sources, and flag anything that contradicts the charted design (per-device DEK records, iroh-docs primary, foreground sync over n0 public relay).

## Resolution

Research note: `.wayfinder/sync/research/S1-iroh-docs-wasm.md` (2026-08-13).

**Verdict — stack is viable except for durability.** As of iroh 1.0: (1) `iroh` and the full protocol stack compile to `wasm32-unknown-unknown` via wasm-bindgen with `default-features = false`; n0 CI tests it; build path is `cargo build --target wasm32-unknown-unknown` + wasm-bindgen-cli with `--cfg getrandom_backend="wasm_js"`. (2) `iroh-docs` (a separate crate, not an iroh feature) gained wasm support in Feb 2026 — but the browser store is **memory-only** (no IndexedDB; `Docs::persistent`/`FsStore` are file-based and native-only), so a page close wipes the doc, authors, and default author; even the endpoint `SecretKey` (node identity) is random per bind unless we persist it. **"iroh-docs primary" therefore needs our own IndexedDB persistence layer — the charted design assumed persistence that does not exist in the browser build.** (3) Browser nodes connect relay-only over WebSocket, E2E-encrypted; n0 public relays are the default (`*.relay.n0.iroh.link.`), configurable via `RelayMode::Custom`; relays see only metadata (IPs/timing/volumes), public relay is "dev/hobby only". (4) `DocTicket` (capability + peer nodes) is the whole join primitive — `doc.share(ShareMode::Write)` → import on the other device grants read+write; per-key set reconciliation (Meyer 2022) + per-key LWW by timestamp match the whole-record-LWW merge unit; iroh-docs has **no built-in per-record encryption**, so the DEK/re-encrypt-on-merge layer is the only data confidentiality. (5) **No official wasm NPM package** — `@number0/iroh` on npm is a native Node NAPI addon; we must build our own wasm wrapper crate. (6) Flags: docs page still lists only iroh-gossip as browser-capable (lags merged iroh-docs wasm), iroh-docs has no wasm CI job, and no bundle-size figures are published (release + wasm-opt recommended).

**Consequence for the map:** keep iroh-docs + iroh over the n0 relay, but the "iroh-docs is the store of truth" decision needs a follow-up ticket for browser persistence (IndexedDB mirror + re-hydration of doc/authors/SecretKey), and the wasm wrapper crate is its own workstream.
