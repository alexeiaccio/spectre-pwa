---
id: S4
title: Minimal iroh-in-Vite build spike
type: prototype
status: open
blocked_by: [S1]
assigned:
---

## Question

Prove the toolchain: two tabs/devices running this exact Vite + SolidJS 2 PWA exchange one key-value record over iroh through the n0 public relay.

- **Build pipeline**: wasm-pack/wasm-bindgen inside Vite; wasm + js module wired into the bundle; worker placement (main thread vs dedicated worker — does iroh's async want a worker?); interplay with the existing `generateSW` PWA + `virtual:pwa-register`.
- **Runtime check**: start endpoint, create doc, export capability, join doc from a second tab, sync a record, confirm the relay path is exercised and traffic is E2E-encrypted.
- **Cost**: bundle size + startup latency on a small device.
- Deliver the spike as a prototype asset linked from this ticket.
