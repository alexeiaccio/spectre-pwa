---
id: M2
title: Upstream iroh-docs browser-sync reliability status
type: research
status: closed
blocked_by: []
assigned: dev
---

## Question

S7 concluded browser-to-browser docs sync is unreliable in iroh-docs 0.101 wasm and recommended filing/querying an upstream issue. Collect the facts the experimental flag's accuracy needs:

- (a) Is there an existing n0-computer/iroh or iroh-docs issue about **wasm/browser sync reliability** (the "Failed to establish connection" after `start_sync` over a relay)? If not, draft the issue text (repro: two browser tabs, relay dial works, docs engine sync nondeterministic) and record where it should go.
- (b) Have **newer iroh-docs releases** (post-0.101) shipped fixes for browser sync? Check the n0 changelog/releases and the `wasm_test` CI status.
- (c) Is there an official or community **native relay-side participant / browser-gateway** pattern (a Node/CLI iroh node that joins the doc on the user's behalf and relays records to browsers) — S7's proposed rescope? How mature is it?
- (d) What does the current `crates/spectre-sync` version pin (Cargo.toml) and is there a clear upgrade path?

Write findings to `.wayfinder/s6/research/M2-iroh-sync-upstream-status.md`. Cite versions, dates, URLs. This feeds the experimental flag + the fog (native participant). Do not implement.

## Resolution

Findings at `research/M2-iroh-sync-upstream-status.md`.

- **No upstream issue exists** for wasm/browser docs-sync reliability — a ready-to-paste repro issue was drafted (to file in `n0-computer/iroh-docs`, cross-linking #51, #74, iroh #4319). Root cause of the gap: the engine's `connect_and_sync` dials a bare `EndpointAddr` (pkarr-dependent) while relay-URL dials work — and **zero browser-runtime sync tests exist in any upstream CI** (iroh-docs' `wasm_build` job is build-only).
- **No fix shipped**: iroh-docs 0.101.0 (2026-06-15) is still latest; only unreleased change is #110 (gossip receive-loop robustness, Jul 15). Pins are already latest.
- **Native relay-side participant** is the officially recommended architecture but **no off-the-shelf gateway exists** (iroh-cli abandoned, `@number0/iroh` NAPI excludes docs, `iroh-gateway` is blobs-only) — it must be built as a Rust daemon. `browser-chat` (deployed) proves the browser+CLI hybrid topology.
- Feeds: the experimental flag stays accurate (S7 verdict stands); the fog item "native participant" is real but a build, not a pick-up.
- **Action for this repo**: file the drafted upstream issue (task, cheap) so the gap is tracked outside this repo.
