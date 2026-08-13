---
id: S1
title: iroh-docs in the browser — wasm feasibility
type: research
status: in_progress
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
