# M1 — iroh node secret-key persistence feasibility

**Date:** 2026-08-14 · **Status:** decision-ready (feeds M6 mirror semantics + M9 crate change) · **Repo:** `/Users/a.tukachev/github/spectre-pwa`
**Versions verified:** `iroh 1.0.3`, `iroh-docs 0.101.0`, `iroh-blobs 0.103.0`, `iroh-gossip 0.101.0`, `iroh-base 1.0.3`, `iroh-tickets 1.0.0`, `n0-watcher 1.0.0`, `n0-future 0.3.2`, `wasm-bindgen 0.2.127` (lock; `Cargo.toml` says `0.2.122`). Sources read from `~/.cargo/registry/src/index.crates.io-*/` (the exact versions in `crates/spectre-sync/Cargo.lock`).

---

## Verdict (short answer)

- The **`SecretKey` is the entire node identity**: `EndpointId = SecretKey.public()` (`iroh-1.0.3/src/endpoint.rs:1183`). Persist its 32 bytes and pass them to `Endpoint::builder().secret_key(...)` → **the same node id survives every reload**. Fully supported in the wasm build, no new iroh feature needed. This is the *documented* persistent-identity pattern (see Sources).
- The **`DocTicket` string alone is sufficient** to re-attach a doc after reload for both read *and* write — the Write capability embedded in the ticket is the full `NamespaceSecret` (32 bytes) plus the sharer's `EndpointAddr`s. `author` keys are **not required** for correctness (a fresh random author can sign writes); they are only needed to keep a **stable author identity** for attribution.
- The **current `crates/spectre-sync` exposes nothing** about the SecretKey: `start()` is parameterless, generates a fresh random key every `bind()`, and never stores it. Export is trivial because iroh already exposes `Endpoint::secret_key() -> &SecretKey` (one-liner).
- Minimal crate surface to close the gap: **3–4 new wasm-bindgen methods** (`start_with_secret_key`, `export_secret_key`, and optionally author export/import). Doc re-attach already works via the existing `import_ticket`/`join_and_sync` (ticket string in, capability + sync out).

---

## (a) How the node is created today (`crates/spectre-sync`)

`crates/spectre-sync/src/lib.rs`:

- `SyncNode::start()` (`lib.rs:36-63`): `Endpoint::builder(presets::N0).alpns(vec![blobs ALPN, gossip ALPN, docs ALPN]).bind().await` → `MemStore::default()` for blobs → `Gossip::builder().spawn(endpoint.clone())` → `Docs::memory().spawn(endpoint, blobs, gossip)` → `Router` accepting the three ALPNs → `ensure_online()` waits for an established relay connection.
- **No SecretKey is accepted, generated on purpose, or stored by the wrapper.** iroh's `Builder::bind` does `let secret_key = self.secret_key.unwrap_or_else(SecretKey::generate);` (`iroh-1.0.3/src/endpoint.rs:226`) — so every `SyncNode::start()` yields a **new random node id**.
- `node_id()` (`lib.rs:291`) returns `endpoint.id().to_string()` — the *current* (random) id; nothing to tie it to the previous session.
- The docs store is memory-only: `Docs::memory()` (`iroh-docs-0.101.0/src/protocol.rs:33`) → `Store::memory()` (redb in-RAM) + `DefaultAuthorStorage::Mem` — see (b).
- Pinned versions in `crates/spectre-sync/Cargo.toml`: `iroh = { version = "1", default-features = false, features = ["tls-ring"] }`, `iroh-blobs 0.103`, `iroh-docs 0.101`, `iroh-gossip 0.101` (locked: iroh 1.0.3, iroh-docs 0.101.0, iroh-blobs 0.103.0).

**Key finding:** nothing blocks persistence — `Endpoint::secret_key()` already exists (`iroh-1.0.3/src/endpoint.rs:1175-1177`), so exporting the key is `endpoint.secret_key().to_bytes()`, and the builder accepts one via `.secret_key(SecretKey)` (`endpoint.rs:524`).

## (b) What iroh 1.0 / iroh-docs 0.101 requires to survive a restart

### Node identity — the `SecretKey` (iroh 1.0.3, `iroh-base-1.0.3/src/key.rs`)
- `SecretKey` is an ed25519 signing key, `#[derive(Clone, ZeroizeOnDrop)]` (`key.rs:260`).
- `SecretKey::to_bytes() -> [u8; 32]`, `SecretKey::from_bytes(&[u8; 32]) -> Self`, `SecretKey::generate()` (`key.rs:318, 332, 337`). `FromStr` parses a base32-hex string (`key.rs:269`); serde `Serialize/Deserialize` also implemented (`key.rs:278`).
- Re-exported at `iroh` crate root (`iroh-1.0.3/src/lib.rs:284`), so `use iroh::SecretKey` works in the wrapper with zero extra deps.
- `Endpoint::id()` = `secret_key.public()`; `Endpoint::secret_key()` accessor exists (`endpoint.rs:1175-1184`).
- iroh's canonical advice: *"Each time you bind without supplying a secret key, iroh generates a brand new random identity … If you want a stable identity that survives restarts … generate a `SecretKey` once, store it, and load the same key on every subsequent launch"* — documented example `Endpoint::builder().secret_key(secret_key).bind(...)` (docs.iroh.computer/connecting/creating-endpoint#persistent-identity). n0 even ships `iroh_persist` for the native file-backed key store (`docs.rs/iroh-persist`); in a browser we do the same store ourselves in IndexedDB.
- **To rebuild an endpoint with the same node id:** persist `[u8; 32]` (e.g. hex), restore with `SecretKey::from_bytes`, pass to `Endpoint::builder(presets::N0).secret_key(sk).alpns(...).bind()`.

### Doc capability — the `DocTicket` (iroh-docs 0.101.0)
- `DocTicket { capability: Capability, nodes: Vec<EndpointAddr> }` (`src/ticket.rs`); `FromStr`/`Display` are the postcard/base32 `Ticket` codec (`iroh-tickets 1.0.0`). `nodes` is validated non-empty on decode.
- `Capability::Write(NamespaceSecret)` is a full 32-byte write secret; `Capability::raw() -> (u8, [u8; 32])` / `Capability::from_raw(kind, bytes)` give a compact lossless encoding (`src/sync.rs:220-243`).
- **Re-attach after reload:** `DocsApi::import(ticket)` = `import_namespace(capability)` + `start_sync(nodes)` (`src/api.rs:220-225`). `import_namespace` stores the capability in the replica store (`src/store/fs.rs:423`), making the doc writable and reconcilable again. The wrapper's existing `import_ticket`/`join_and_sync` already do exactly this — **no new doc-import API is needed; persisting the ticket string is enough.**
- Alternative compact persistence: persist `Capability::raw()` (kind byte + 32 bytes) instead of the whole ticket; re-attach via `import_namespace(Capability::from_raw(...))` + a `start_sync(vec![])` and rely on gossip/discovery. Ticket string is simpler and also carries peer addrs (useful since browser nodes are relay-only).

### Author keys (needed only for author-identity stability)
- `Author` wraps a `SecretKey`, `Author::to_bytes()/from_bytes()` exist (`src/keys.rs:14-56`); `author_export(author_id) -> Option<Author>` / `author_import(author)` on `DocsApi` (`src/api.rs:169-183`); `author_set_default` (`api.rs:150`).
- **Critical memory-mode fact:** `Docs::memory()` uses `DefaultAuthorStorage::Mem`, which **creates a brand-new random author on every engine spawn** — `Author::new(&mut rand::rng())` in `DefaultAuthorStorage::load` (`src/engine.rs:364-371`). So after a reload `author_default()` returns a *different* author id than before. The persistent (native, `fs-store`-gated) path persists the default-author id to a file; the browser path has no equivalent — the app must persist the author's 32 bytes itself and re-import (`author_import` + `author_set_default`) to keep the same default author.
- `set_bytes` (writing) does **not** require a previously-known author: an entry's signature is verified against the author's public key embedded in the entry and against the namespace secret (`src/keys.rs`), so **any fresh ed25519 key can write**. LWW is per `(namespace, author, key)` with `Query::single_latest_per_key()` → newest timestamp wins regardless of which author wrote it.

### Bottom line for (b) — the persistence list
1. **Node `SecretKey`** — 32 bytes (hex in IndexedDB) → `Endpoint::builder().secret_key(...)` → same `EndpointId` forever.
2. **`DocTicket` string** (Write) — encodes `NamespaceSecret` + peer addrs → `docs.import(ticket)` re-attaches and restarts sync.
3. **Default `Author`** (optional, for stable author id) — 32 bytes → `author_import` + `author_set_default`.

## (c) Recommended `crates/spectre-sync` wasm surface (sketch only, do-not-implement)

Keep the existing methods untouched (M9 requires API stability for `src/lib/sync/adapter.ts`); add these to `impl SyncNode`:

```rust
#[wasm_bindgen]
impl SyncNode {
    /// Start the node from a persisted SecretKey (32 bytes, hex-encoded).
    /// Same node id on every call with the same key.
    pub async fn start_with_secret_key(secret_key_hex: &str) -> Result<SyncNode, JsError>;

    /// Export this node's SecretKey as hex (32 bytes). Call once, store in IndexedDB.
    pub fn export_secret_key(&self) -> Result<String, JsError>;

    /// Export the default author's 32 bytes as hex (optional; keeps author identity stable).
    pub async fn export_default_author(&self) -> Result<String, JsError>;

    /// Import a 32-byte author (hex) and make it the node default (optional).
    pub async fn import_default_author(&self, author_hex: &str) -> Result<(), JsError>;
}
```

Details/notes:
- Implement by refactoring `start()` into a private `start_inner(Option<SecretKey>)`; `start()` calls it with `None` (backward compatible, still random), `start_with_secret_key` with `Some(SecretKey::from_bytes(&bytes))`. Error path: reject any input that isn't exactly 32 bytes via the existing `decode_hex` helper + `to_js`/`JsError` (existing pattern, `lib.rs:334-346`).
- `export_secret_key`: `Ok(hex(&self.endpoint.secret_key().to_bytes()))`. Hex is consistent with the wrapper's existing hex-string surface (`node_id()`, `connect_docs`, ticket id helpers). Alternative: `Vec<u8>`/`&[u8]` (wasm-bindgen maps to `Uint8Array`) if binary is preferred over hex.
- **Doc re-attach needs no new API** — `import_ticket(ticket)` / `join_and_sync(ticket)` already take the ticket string and re-import the capability + start sync. Optional niceties (not required): `reshare(doc_id) -> String` to mint a *fresh* ticket with current relay addrs if the stored ticket's addrs go stale; or `export_doc_capability(doc_id)` returning `Capability::raw()` bytes if we prefer not to store the whole ticket.
- Error handling stays `Result<T, JsError>`; no panics; `SecretKey` never crosses into JS except as the exported 32 bytes.
- **Security note for M6:** the SecretKey must be treated as sensitive (anyone holding it impersonates the node). IndexedDB is XSS-readable; consider encrypting the stored 32 bytes at rest (e.g. with the vault DEK, per T1/S3) before persisting, not plaintext.

## (d) Does `create_doc`/`join_and_sync`/`subscribe` survive a reload on SecretKey + DocTicket only?

**Yes** — the doc capability is sufficient for read and write; author keys are not needed for correctness.

- `join_and_sync(ticket)` / `import_ticket(ticket)` after reload: re-imports the Write capability into the fresh (empty) memory replica store and re-runs set reconciliation with the ticket's peers. Entries are re-fetched from whichever ticket peer is online → reads work again. Ticket nodes carry relay URLs (`ShareMode::Write` + `RelayAndAddresses`, `ensure_online` wait), and our node id is unchanged (restored key), so the stored tickets stay valid.
- `create_doc()`: unaffected (fresh namespace; nothing to persist).
- `subscribe(doc_id)`: works once the doc is re-imported + syncing (live events via the gossip swarm); must follow `import_ticket` in the boot sequence because `open()` on an un-imported doc errors (`Replica not found`, `src/store.rs:25-26`).
- `set(doc_id, key, value)`: works after reload — `author_default()` returns a *new* random author (memory mode), which can still sign entries; peers accept it. **Consequence:** unless the author bytes are persisted too, each reload mints a new author id, so entries written after reload carry a different author than before. Harmless for doc correctness and LWW; relevant only if author id is used as device/record attribution. (Note: today the app's device id in envelope records is `crypto.randomUUID()` in `src/lib/sync/pairing.ts:33`, **decoupled** from the iroh node id — so node-id instability would *not* corrupt envelope keys, but a lost SecretKey still changes the node id and requires re-pairing.)
- **Caveat — cold-start emptiness:** the memstore (both replica *and* blobs) is empty at boot. If no ticket peer is online when the app starts, the store stays empty until a peer connects (entry-value-in-key trick sidesteps the missing blobs; a future content-blob read path would need the downloader to re-fetch). This is the exact gap M6 (node mirror in IndexedDB) must close for offline reads of already-synced records.
- Minor: on re-import of a ticket created by *this same* (now reloaded) node, the ticket's peer list includes our own restored node id — verify iroh handles self-dial gracefully, or filter our own id from `ticket.nodes` in the wrapper.

## Open questions for M6 / M9

1. **Author persistence scope:** keep author identity stable across reloads (persist + `import_default_author`), or accept a new random author per boot? Depends on whether record/envelope attribution needs a stable author id (S2 keys envelope records by app `deviceId`, not author id — likely optional).
2. **SecretKey at rest:** encrypt the persisted 32 bytes with the vault DEK, or plaintext IndexedDB? (Security decision, T1/S3 adjacent.)
3. **Boot order contract:** `start_with_secret_key → import_ticket/join_and_sync → subscribe` — the mirror (M6) must pin this sequence and the error handling when the doc capability is missing (fresh vault vs. re-pair).
4. **Cold-start offline reads:** memstore empties on reload — M6 mirror must serve reads from IndexedDB when peers are offline; confirm whether the wrapper needs a `set`-path that also writes through to the mirror or the bridge (M8) handles it.
5. **Self-dial** of a restored node's own id in a stored ticket — needs a quick spike check.

## Sources (primary)

- `crates/spectre-sync/src/lib.rs` + `Cargo.toml` + `Cargo.lock` (this repo) — current wrapper, pinned versions.
- `iroh-1.0.3/src/endpoint.rs` — `Builder::secret_key` (524), `Builder::bind` → `secret_key.unwrap_or_else(SecretKey::generate)` (226), `Endpoint::secret_key()` (1175), `Endpoint::id()` (1183).
- `iroh-base-1.0.3/src/key.rs` — `SecretKey::to_bytes/from_bytes/generate/public`, base32hex `FromStr` (269-337).
- `iroh-1.0.3/src/lib.rs:284` — `SecretKey` re-export at crate root.
- `iroh-docs-0.101.0/src/ticket.rs` — `DocTicket { capability, nodes }`, postcard `Ticket` codec.
- `iroh-docs-0.101.0/src/sync.rs:177-243` — `Capability::Write(NamespaceSecret)` / `Read(NamespaceId)`, `raw()/from_raw()`.
- `iroh-docs-0.101.0/src/api.rs` — `import` (220), `import_namespace` (214), `share` (423), `author_export/import/set_default` (150-183), `start_sync` (437).
- `iroh-docs-0.101.0/src/engine.rs:349-433` — `DefaultAuthorStorage::Mem` creates a new random author per spawn; fs-store persists default-author id to a file.
- `iroh-docs-0.101.0/src/protocol.rs:31-45` — `Docs::memory()` vs `fs-store`-gated `Docs::persistent(path)`.
- `iroh-docs-0.101.0/src/keys.rs` — `Author` (14-56), `NamespaceSecret` (92-134).
- `iroh-docs-0.101.0/src/store.rs:25-26` — "Replica not found" on open of unknown doc.
- https://docs.iroh.computer/connecting/creating-endpoint (incl. **Persistent identity** section: store `SecretKey`, pass via `Builder::secret_key`, same `EndpointId` every run) — fetched 2026-08-14.
- https://docs.rs/iroh/latest/iroh/endpoint/struct.Builder.html (`secret_key` docs) and https://docs.rs/iroh/latest/src/iroh/endpoint.rs.html.
- https://docs.rs/iroh-persist/latest/iroh_persist/ — native file-backed key persistence crate; the pattern to mirror in IndexedDB.
- https://docs.iroh.computer/concepts/endpoints — "By default, creating an endpoint generates a new random identity … store the endpoint's `SecretKey` and load it on every launch."
- S1 research `.wayfinder/sync/research/S1-iroh-docs-wasm.md` — browser store is memory-only; `SecretKey` not persisted for us (S1 §2, §6.1).
- S2 resolution `.wayfinder/sync/tickets/S2-sync-record-schema.md` — envelope records keyed by app `deviceId`; LWW per key; capability not revocable.
- `src/lib/sync/adapter.ts`, `src/lib/sync/pairing.ts` — current adapter surface (M9 must stay compatible) and `crypto.randomUUID()` deviceId.
