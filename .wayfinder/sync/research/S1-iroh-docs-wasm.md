# S1 — iroh-docs in the browser — wasm feasibility

**Date:** 2026-08-13 · **Status:** Decision-ready · **Scope:** iroh 1.0 (stable, June 2026), `iroh-docs` 0.101.0 · **Repo:** `/Users/a.tukachev/github/spectre-pwa`

---

## Verdict (short answer)

The stack is **partially viable** — with one fatal gap for the charted design:

- ✅ `iroh` compiles to `wasm32-unknown-unknown` via wasm-bindgen with `default-features = false`; n0 ships this as a supported, CI-tested path.
- ✅ **`iroh-docs` also compiles to wasm as of Feb 2026** (merged upstream, released in 0.97+; current 0.101.0 = the 1.0 line). iroh-docs is a *separate crate*, not a feature of `iroh`.
- ❌ **In a browser the iroh-docs store is memory-only.** There is **no IndexedDB backend**; `Docs::persistent()` is file-based (`redb`, native-only) and unavailable in wasm. Every page close **wipes the doc** and the node's author keys. "iroh-docs is the primary vault store" for an offline-first PWA that closes and reopens is **not viable as-is** — persistence must be added by us (e.g. our own IndexedDB mirror + re-hydration).
- ✅ Browser nodes connect to a relay over **WebSocket**, **E2E-encrypted** (relay cannot decrypt); the n0 public relay is the default and the URL is configurable.
- ✅ The doc ticket (`DocTicket` = capability + nodes) is exactly the join primitive needed; `ShareMode::Write` grants read+write to the second device; per-key set reconciliation + per-key LWW match the "whole-record last-writer-wins" assumption.
- ⚠️ **No official wasm NPM package** — we must write our own Rust→wasm wrapper crate (as the docs recommend). The npm `@number0/iroh` package is a *native* Node NAPI addon, not wasm.
- ⚠️ Even transport identity is not persisted for us: the endpoint's `SecretKey` is random per `bind()` unless the app stores it.

Details and citations below.

---

## 1. Wasm build

**Answer: yes — `iroh` (and the whole protocol stack) builds for `wasm32-unknown-unknown` via wasm-bindgen; use `default-features = false`.**

Official docs, *WebAssembly and Browsers* ([docs.iroh.computer/languages/wasm-browser](https://docs.iroh.computer/languages/wasm-browser)):

> Add `iroh` to your browser project's dependencies and keep building it using [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen/).
> You need to disable iroh's default features for the Wasm build to succeed. To do so, depend on iroh via `iroh = { version = "1", default-features = false }`. This drops the `metrics` feature, so iroh no longer tracks metrics locally.

**n0's own CI proves the path.** `iroh/.github/workflows/ci.yml` has a `wasm_test` job that:
- sets `RUSTFLAGS: '--cfg getrandom_backend="wasm_js"'`,
- `rustup target add wasm32-unknown-unknown`,
- installs `wasm-bindgen-cli@0.2.122` (pinned to match the `wasm-bindgen` in `Cargo.lock`),
- installs Node 22.5 ("needed for browser-like websocket API support in node.js"),
- runs `cargo build --target wasm32-unknown-unknown -p iroh-base`, `-p iroh-relay`, `-p iroh`, then `cargo test -p iroh --test integration --target=wasm32-unknown-unknown`,
- verifies no `import "env"` leaks via `wasm-tools print --skeleton`.

**Exact build path used by n0's own example** (`n0-computer/iroh-examples`, `browser-echo`, [README](https://github.com/n0-computer/iroh-examples/tree/main/browser-echo)):

```sh
$ cargo install wasm-bindgen-cli
$ rustup target install wasm32-unknown-unknown
$ npm install
$ npm run build        # = cargo build --target=wasm32-unknown-unknown && wasm-bindgen ... --target=web
$ npm run serve
```

with `browser-echo/package.json` scripts:

```json
"build":         "CARGO_TARGET_DIR=./target cargo build --target=wasm32-unknown-unknown && wasm-bindgen ./target/wasm32-unknown-unknown/debug/browser_echo.wasm --out-dir=public/wasm --weak-refs --target=web --debug",
"build:release": "... && wasm-bindgen ./target/wasm32-unknown-unknown/release/browser_echo.wasm --out-dir=public/wasm --weak-refs --target=web && wasm-opt --enable-nontrapping-float-to-int --enable-bulk-memory -Os -o public/wasm/browser_echo_bg.wasm ..."
```

and `browser-echo/.cargo/config.toml`:

```toml
[target.wasm32-unknown-unknown]
rustflags = ['--cfg', 'getrandom_backend="wasm_js"']
```

So the supported toolchain is plain `cargo build` + **wasm-bindgen-cli** (not wasm-pack, though wasm-pack would work — it's the same underlying tooling). `wasm-bindgen-futures` is used, so async iroh runs on JS promises on the main browser thread.

**Known browser caveats** (primary sources):
- `metrics` must be off → `default-features = false`. Default features are `tls-ring` (crypto provider), `metrics`, `portmapper`, `fast-apple-datapath` ([docs.rs/crate/iroh/latest/features](https://docs.rs/crate/iroh/latest/features), [iroh#3992](https://github.com/n0-computer/iroh/issues/3992)). In wasm, `presets::N0` needs a crypto provider — provided by the `tls-ring`/`tls-aws-lc-rs` feature; with **neither** enabled, you must call `Builder::crypto_provider` yourself (iroh#3992).
- No `wasm32-wasi`, and no raw `wasm32-unknown-unknown` without wasm-bindgen ([iroh#2799](https://github.com/n0-computer/iroh/issues/2799), [iroh 0.33 blog](https://www.iroh.computer/blog/iroh-0-33-0-browsers-and-discovery-and-0-RTT-oh-my)).
- `getrandom` needs the `wasm_js` backend (hence the rustflag above); `ring` needs a wasm-capable clang (Apple clang fails); stray tokio `full/net/fs` features break the build ([iroh discussion #3200](https://github.com/n0-computer/iroh/discussions/3200)).
- In browsers, the `N0` preset resolves addresses via **HTTPS to n0's DNS server (`PkarrResolver`)** instead of DNS queries (`iroh/src/endpoint/presets.rs`).

**`iroh-docs` is a separate crate**, not a feature of `iroh`. Its wasm build uses `default-features = false` too (`iroh-docs/Cargo.toml`: `iroh = { version = "1", default-features = false }`, `iroh-blobs = { ..., default-features = false }`, `iroh-gossip = { ..., default-features = false }`).

## 2. Docs store in browsers — persistence

**Answer: the iroh-docs browser store is memory-only. Nothing persists across page close. No IndexedDB / localStorage backend exists.**

This changed recently, so cite carefully:

- **PR n0-computer/iroh-docs#75 "feat: build on wasm"** ([github.com/n0-computer/iroh-docs/pull/75](https://github.com/n0-computer/iroh-docs/pull/75)), merged **2026-02-24**:
  > Make iroh-docs work in WebAssembly in the browser, **memstore only**.
  > … `redb` works in-memory in the browser. **No persistent store for now.** In native environments, we spawn a separate thread for the storage actor … In wasm, we instead simply run this on the main thread.
- **PR #84** (conflict-cleanup on top, merged 2026-02-24) verified the exact build: `cargo build --target wasm32-unknown-unknown --no-default-features` — "builds successfully", no `import "env"` leaks ([iroh-docs#84](https://github.com/n0-computer/iroh-docs/pull/84)).

**Where the store split lives in source** (`iroh-docs/src/protocol.rs`):

```rust
pub fn memory() -> Builder { Builder::default() }                    // always available
#[cfg(feature = "fs-store")]
pub fn persistent(path: std::path::PathBuf) -> Builder { ... }       // native-only
```

`iroh-docs/src/store/fs.rs` — the in-memory backend is redb's RAM backend:

```rust
pub fn memory() -> Self {
    let db = Database::builder().create_with_backend(redb::backends::InMemoryBackend::new())?;
    ...
}
#[cfg(feature = "fs-store")]
pub fn persistent(path: impl AsRef<std::path::Path>) -> Result<Self> { ... }
```

`iroh-docs/Cargo.toml` default features: `metrics`, `rpc`, `fs-store`, `redb-v2-migration`. There is **no IndexedDB-backed store** anywhere in the crate, and **no encryption feature** (see §4). The docs' own documents page says the persistent path is `Docs::persistent(path)` + `FsStore::load(path)` — both file-based ([docs.iroh.computer/protocols/documents](https://docs.iroh.computer/protocols/documents)) — i.e. native-only.

**Consequences for the charted design:**
- A browser iroh-docs node cannot survive a page reload: doc entries, authors, and the default author are all in RAM. "iroh-docs is the store of truth" as the *durable* vault store is **not possible today** unless we add our own IndexedDB layer (mirror entries + re-import after reload) — a real engineering decision, not a config flag.
- Even the **endpoint's `SecretKey`** (your node identity) is `SecretKey::generate()` per `bind()` when not set (`iroh/src/endpoint.rs`, `Builder::bind`). The browser build has no built-in persistence for it either — the app must save it (IndexedDB) and pass `Builder::secret_key(...)` to keep a stable `EndpointId` across reloads.
- Note the official wasm docs page lags the code: it still lists only `iroh-gossip` as a protocol with browser support ("Future Plans", [wasm-browser](https://docs.iroh.computer/languages/wasm-browser)) and does not mention iroh-docs wasm. The iroh-docs repo also has **no wasm CI job** — wasm compilation is verified manually in PRs, not in CI.

## 3. Connectivity

**Answer: browser nodes are relay-only, over WebSocket, E2E-encrypted; the n0 public relays are the hardcoded default; the relay URL set is configurable; the relay sees ciphertext + metadata.**

- **Relay-only, WebSocket.** [wasm-browser docs](https://docs.iroh.computer/languages/wasm-browser): *"All connections from browsers to somewhere else need to flow via a relay server. This is because we can't port our hole-punching logic in iroh to browsers: They don't support sending UDP packets… connections are end-to-end encrypted, as always with iroh. So even though traffic from browsers is always relayed, it can't be decrypted by the relay."* WebTransport/WebRTC are on the roadmap, not today. The original browser PR and 0.32/0.33 blogs are explicit that traffic is *"relayed via WebSocket connections to relays"* ([iroh#2799](https://github.com/n0-computer/iroh/issues/2799), [0.33 blog](https://www.iroh.computer/blog/iroh-0-33-0-browsers-and-discovery-and-0-RTT-oh-my)); the CI even pins Node 22.5 for its browser-like WebSocket API.
- **Default n0 public relays** (production, hardcoded in `iroh/src/defaults.rs`, `mod prod`):

  | Region | URL |
  |---|---|
  | NA east | `https://use1-1.relay.n0.iroh.link.` |
  | NA west | `https://usw1-1.relay.n0.iroh.link.` |
  | EU | `https://euc1-1.relay.n0.iroh.link.` |
  | Asia-Pacific | `https://aps1-1.relay.n0.iroh.link.` |

  These are applied via `RelayMode::Default` → `crate::defaults::prod::default_relay_map()`; `presets::N0` calls `builder.relay_mode(default_relay_mode())` (`iroh/src/endpoint/presets.rs`).
- **Override / self-host.** `RelayMode::custom([urls])` / `RelayMode::Custom(RelayMap)` via `Builder::relay_mode(...)` ([docs.rs `RelayMode`](https://docs.rs/iroh/latest/iroh/enum.RelayMode.html), [add-a-relay docs](https://docs.iroh.computer/add-a-relay)); runtime add/remove via `Endpoint::insert_relay` / `Endpoint::remove_relay`; `IROH_FORCE_STAGING_RELAYS` env switches to staging servers. This matches the map's "relay URL kept configurable" decision.
- **What the relay sees.** [Public Relays docs](https://docs.iroh.computer/iroh-services/relays/public): *"All traffic through the public relays is end-to-end encrypted. The relays cannot read any of the traffic they forward. However, the relays can see connection metadata: source and destination IP addresses, connection times, and the amount of data transferred."* Public relays are **"suitable for development and hobby use only"**, rate-limited, no SLA, and only the latest stable iroh is supported — so the charted "n0 public relay" is fine for a personal vault MVP but is a known scaling/support boundary.

## 4. Sync primitive — the doc ticket, and merge semantics

**Answer: `DocTicket` (namespace capability + peer addresses) is the whole join primitive; a second device needs exactly one ticket string for read+write; sync is per-key set reconciliation with per-key LWW; there is no built-in per-record encryption.**

- **Sharing** (`iroh-docs/src/api.rs`, [documents docs](https://docs.iroh.computer/protocols/documents)):

  ```rust
  let ticket = doc.share(ShareMode::Write, Default::default()).await?;   // grants write access
  // peer side:
  let ticket = DocTicket::from_str(&ticket_str)?;
  let doc = docs.import(ticket).await?;
  ```

  `DocTicket { capability, nodes }` (destructured in `DocsApi::import`). The **capability** for `ShareMode::Write` is the namespace *secret* (write = full `NamespaceSecret`; read-only capability also exists), and **nodes** are the sharer's `EndpointAddr`s (with relay URL), so the ticket contains both *what* and *where*. `import` = import capability + `start_sync(nodes)` → dials the sharer over the relay, runs set reconciliation, and joins the doc's gossip swarm for live updates. QR-encoding the ticket string is the intended UX ("Tickets work well in QR codes" — [tickets docs](https://docs.iroh.computer/concepts/tickets)).
- **Reconciliation.** Range-based set reconciliation (Meyer 2022, [arxiv.org/abs/2212.13567](https://arxiv.org/abs/2212.13567)): peers recursively partition their entry sets and compare fingerprints; fully-in-sync peers exchange a single fingerprint. Live propagation rides on iroh-gossip; entry *content* rides on iroh-blobs (the doc stores only `hash + size + timestamp` per key) ([documents docs](https://docs.iroh.computer/protocols/documents), [iroh-docs README](https://github.com/n0-computer/iroh-docs)).
- **LWW semantics.** A doc is a CRDT key-value store — "distributed key-value store that can handle concurrent updates from multiple peers, ensuring eventual consistency without conflicts" ([documents docs](https://docs.iroh.computer/protocols/documents)). Each key's winner is the **entry with the greatest timestamp**; the store keeps per-(namespace, author, key) history and exposes `Query::single_latest_per_key()` (see `LatestPerAuthorKey` table and `single_latest_per_key` in `iroh-docs/src/store.rs` + `src/store/fs.rs`). **Map-equivalent:** key = one identity record, value = the whole encrypted record → whole-record last-writer-wins, exactly as the charted design assumes. (Entry values are blobs hashed into iroh-blobs; edits to two *different* identities never conflict; edits to the *same* identity from two devices resolve by timestamp.)
- **Encryption.** iroh 1.0's iroh-docs has **no built-in record encryption** (`iroh-docs/Cargo.toml` features: `metrics, rpc, fs-store, redb-v2-migration` — no `encryption`). Transport is E2E-encrypted endpoint↔endpoint, but every peer holding the doc capability reads entries in plaintext. Per-record AEAD therefore **must** live in the app layer (as the map already intends: per-device DEK, re-encrypt on merge). Flag: the map says "relay sees ciphertext only" — true at the transport layer; it does *not* mean doc peers see ciphertext.

## 5. Packaging

**Answer: no official wasm NPM package — build our own Rust→wasm wrapper crate. The npm `@number0/iroh` package is native (Node-only), not wasm.**

- [wasm-browser docs](https://docs.iroh.computer/languages/wasm-browser): *"Currently we don't bundle iroh's Wasm build as an NPM package. There is no technical limitation for this: You could build this today! Should you need javascript APIs, we recommend that you write an application-specific rust wrapper crate that depends on iroh and exposes whatever the javascript side needs via wasm-bindgen."*
- npm registry: **`@number0/iroh` latest = 1.1.0** — a **NAPI native addon** for Node.js (`"main": "iroh-js/index.js"`, `"engines": {"node": ...}`, `napi` targets like `aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`, etc. — binary name `iroh`, per-OS `.node` files), built on the FFI bindings ([registry.npmjs.org/@number0/iroh](https://registry.npmjs.org/@number0/iroh), [JS bindings docs](https://docs.iroh.computer/languages/javascript)). It is the *native* full-iroh path (hole punching included) for Node/Deno/Bun — explicitly *not* for browsers, where the relay-only wasm subset is preferred ([wasm-browser docs, Node.js/Deno/Bun section](https://docs.iroh.computer/languages/wasm-browser)).
- **Bundle size / load time:** no published figures in docs or release notes. n0's example only notes that a **release build + wasm-opt** is what keeps wasm size down (`browser-echo/package.json` `build:release`). Expect this to be a large wasm module (QUIC + BLAKE3 + crypto in-wasm); size should be validated in a spike before committing to the PWA path.

## 6. Contradictions / flags against the charted design

1. **iroh-docs primary store is not durable in a browser (BLOCKING).** Memory-only store; no IndexedDB; page close loses the doc + authors + node author. "iroh-docs is the primary vault store" needs us to build an IndexedDB persistence layer around it (mirror + re-import, persist `SecretKey`/author keys). This is the single biggest design correction from S1.
2. **Docs lag code on wasm protocol support.** The official wasm-browser page still says only iroh-gossip is browser-capable; iroh-docs wasm (Feb 2026) is not yet documented there, and iroh-docs has no wasm CI. Treat iroh-docs-wasm as "merged & released, lightly tested upstream" — keep the wrapper thin and pin versions.
3. **Relay privacy is metadata-only.** E2E is real, but n0's relay sees IPs, timing, and byte volumes, and the public relay is "dev/hobby" (rate-limited, no SLA, latest-version-only). Fine for personal use; the "swap in a self-hosted relay later" plan is the right hedge.
4. **Per-record encryption is app-level only** — iroh-docs has none. Anyone with the Write ticket can read every record plaintext; the DEK/recovery-code layer is not just flavor, it's the *only* data confidentiality.
5. **No official NPM wasm package** — this effort must own a Rust wrapper crate + wasm build pipeline (feature flags, `getrandom`/clang toolchain, wasm-bindgen version pinning), which is real build infra, not an npm install.
6. Minor: browser nodes are **relay-only** (no hole punching, ever, until WebTransport/WebRTC lands) — the map already assumes this; foreground-only sync is also the only option, matching the map.

## Sources

- https://docs.iroh.computer/languages/wasm-browser (wasm build, features, no npm package, relay-only browsers, E2E, Node/Deno/Bun FFI note)
- https://github.com/n0-computer/iroh/blob/main/.github/workflows/ci.yml (wasm_test job: wasm-bindgen-cli 0.2.122, getrandom_backend wasm_js, Node 22.5, `-p iroh` build + integration test)
- https://github.com/n0-computer/iroh-examples/tree/main/browser-echo (+ `package.json`, `.cargo/config.toml`)
- https://github.com/n0-computer/iroh/discussions/3200 (common wasm build failures: getrandom/ring/tokio-mio, default-features=false)
- https://github.com/n0-computer/iroh/issues/2799 · https://www.iroh.computer/blog/iroh-0-33-0-browsers-and-discovery-and-0-RTT-oh-my · https://www.iroh.computer/blog/iroh-0-32-0-browser-alpha-qad-and-n0-future (WebSocket relay, wasm-bindgen requirement, no wasm-wasi)
- https://github.com/n0-computer/iroh/issues/3992 (pluggable crypto providers, tls-ring/tls-aws-lc-rs, `Builder::crypto_provider` mandatory when neither enabled)
- https://github.com/n0-computer/iroh-docs/pull/75 ("make iroh-docs work in wasm … memstore only … no persistent store for now", merged 2026-02-24)
- https://github.com/n0-computer/iroh-docs/pull/84 (wasm build verified: `--target wasm32-unknown-unknown --no-default-features`)
- https://github.com/n0-computer/iroh-docs/blob/main/src/protocol.rs · `src/store/fs.rs` · `src/api.rs` · `Cargo.toml` (Docs::memory vs fs-store-gated persistent; redb InMemoryBackend; DocTicket{capability,nodes}; share/import; feature list)
- https://github.com/n0-computer/iroh/blob/main/iroh/src/defaults.rs (prod default relay hostnames: `*.relay.n0.iroh.link.`; `RelayMode`, `IROH_FORCE_STAGING_RELAYS`)
- https://github.com/n0-computer/iroh/blob/main/iroh/src/endpoint.rs (+ `Builder::secret_key`, `relay_mode`, `insert_relay`/`remove_relay`) · `iroh/src/endpoint/presets.rs` (N0 preset, PkarrResolver in browsers)
- https://docs.iroh.computer/protocols/documents (tickets, set reconciliation, MemStore/FsStore, Docs::memory/persistent)
- https://docs.iroh.computer/concepts/tickets (ticket anatomy, QR suitability, capability/secrets warning)
- https://docs.iroh.computer/iroh-services/relays/public (public relays: E2E, metadata visibility, dev/hobby only)
- https://docs.iroh.computer/add-a-relay (configuring/overriding relays)
- https://registry.npmjs.org/@number0/iroh (NAPI native Node package, latest 1.1.0)
