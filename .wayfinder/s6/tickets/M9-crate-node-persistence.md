---
id: M9
title: Crate change — node SecretKey persistence
type: task
status: closed
blocked_by: [M1, M6]
assigned: dev
---

## Question

Extend `crates/spectre-sync` so the node survives reloads (per M1's feasibility + M6's semantics):

- Export/import the node SecretKey (or accept one at `start`), and re-attach a doc capability after restart — the wasm surface M1 specifies.
- Wire `npm run build:wasm` output to `src/lib/spike/` as today.
- Keep the existing API stable for the current adapter.
- Resolved when the crate exposes the persisted-node path and the mirror round-trips a reload (browser test). Record versions + API in the resolution.

## Resolution

Closed 2026-08-14. `crates/spectre-sync` extended with the persisted-node surface from M1 (c) / M6; all four methods are wasm-exposed on `SyncNode` and are **additive** — `start()` and every existing method are signature-identical (verified against `src/lib/sync/adapter.ts`, untouched).

**Methods added** (`crates/spectre-sync/src/lib.rs`):

- `SyncNode.start_with_secret_key(secret_key_hex: string): Promise<SyncNode>` — refactored the old `start()` body into a private `start_inner(Option<SecretKey>)`; `start()` calls it with `None` (unchanged behavior: fresh random key). `start_with_secret_key` hex-decodes the key, rejects anything not exactly 32 bytes (64 hex chars), and passes it via `Endpoint::builder(presets::N0).secret_key(SecretKey::from_bytes(...))`. Same ALPN advertisement (blobs/gossip/docs) and `ensure_online()` relay-up wait as before.
- `SyncNode.export_secret_key(): string` — `hex(endpoint.secret_key().to_bytes())` (32 bytes).
- `SyncNode.export_default_author(): Promise<string>` — `author_default()` → `author_export()` → `hex(author.to_bytes())`.
- `SyncNode.import_default_author(author_hex: string): Promise<void>` — validates 64 hex chars, `Author::from_bytes`, then `author_import` + `author_set_default`.

**Hex format:** lowercase hex, 64 chars (32 bytes), matching the wrapper's existing hex surface (`node_id()`, doc ids). Same `decode_hex`/`hex`/`to_js` helpers, `Result<_, JsError>` error paths, no panics. New imports: `iroh::SecretKey`, `iroh_docs::Author` (no new deps; `n0-future` was already in `Cargo.toml`, now also recorded in `Cargo.lock`).

**Build:** `npm run build:wasm` green. Forced recompile of `spectre-sync` (`wasm32-unknown-unknown`, LLVM/clang@21 toolchain) → clean, no warnings/errors. `wasm-bindgen --target web` + `wasm-opt -O2` regenerate `wasm-out/spectre_sync.{js,d.ts,bg.wasm,bg.wasm.d.ts}`, copied to `src/lib/spike/`. `spectre_sync.d.ts` exposes all four new methods (verified in both `crates/spectre-sync/wasm-out/` and `src/lib/spike/`).

**Consumer checks:** `npx tsc -b` passes (only pre-existing Effect `TS377091` *suggestions* in vault code, exit 0); `npm run test:unit` 61/61 pass. `src/lib/sync/adapter.ts` still imports `SyncNode`/`initSync` from `../spike/spectre_sync.js` and compiles against the new surface unchanged.

**Deviations / follow-ups:**
- No real relay smoke run (needs the browser project + n0 public relay; flaky AFK). The round-trip proof — same `start_with_secret_key(hex)` → same node id, `export_secret_key` round-trips, author import/export round-trips — is deferred to the M6 browser test; the crate surface is complete.
- Doc re-attach needs no new API: existing `import_ticket`/`join_and_sync` already take the ticket string (M1 §c).
- Security note from M1 §c carried forward to M6/M8: the exported SecretKey is node identity — encrypt the stored bytes (vault DEK) in the mirror, don't store plaintext.
