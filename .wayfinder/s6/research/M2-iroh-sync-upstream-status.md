# M2 — Upstream iroh-docs browser-sync reliability status

**Ticket:** `.wayfinder/s6/tickets/M2-iroh-sync-upstream-status.md`
**Researched:** 2026-08-14 (AFK) · **Scope:** iroh 1.0.x, `iroh-docs` 0.101, browser (wasm) sync over the n0 public relay
**Feeds:** the S6 experimental flag, the S7 "native relay-side participant" rescope option, and the upstream issue to file.

---

## Status — summary verdict

1. **(a)** **No upstream issue exists** for browser/wasm docs-sync reliability ("Failed to establish connection" after `start_sync`). Nothing in `n0-computer/iroh-docs` or `n0-computer/iroh` covers a wasm/browser failure of the docs engine. **Draft issue text is below; file it in `n0-computer/iroh-docs`** (the docs engine + the wasm CI job live there), cross-linking the two nearest existing issues (iroh-docs #51, iroh #4319).
2. **(b)** **`iroh-docs` 0.101.0 is still the latest release** (2026-06-15). No 0.102+ has shipped. Since 0.101 the only substantive change on `main` is an **unreleased** gossip receive-loop robustness fix (#110, merged 2026-07-15); two sync-relevant fixes are **open** PRs (#112 content-download retry, #93 pubkey-cache bound). **No browser-sync fix has shipped.** The wasm CI job (`wasm_build` in iroh-docs `ci.yaml`) has existed since the wasm feature landed (Feb 2026) but is **build-only** — it compiles and checks for `import "env"`, it does **not** run any docs sync test in a browser. S1's claim "no wasm CI job" is inaccurate in letter (a wasm build job exists) but right in substance (no wasm *runtime* test of sync exists upstream, anywhere — the iroh repo's `wasm_test` covers only the `iroh` transport crate).
3. **(c)** The native relay-side participant is **the officially recommended architecture** ("browsers complement native deployments") and its building blocks are GA, but **there is no off-the-shelf gateway component**: no maintained iroh CLI (abandoned at 0.28.1, Nov 2024), iroh-docs is **out of scope** for the official Node NAPI bindings (`@number0/iroh`), and the only official "gateway" example (`iroh-gateway`) serves **blob content**, not docs records. A docs relay-participant must be built as a small Rust daemon (iroh 1.0.3 + iroh-docs 0.101 native, `Docs::persistent`, always-online). Topology precedent exists and is deployed: `browser-chat` (browser + CLI gossip peers sharing a channel). Direct browser↔browser WebRTC/WebTransport remains experimental/community.
4. **(d)** `crates/spectre-sync/Cargo.toml` + its `Cargo.lock` are **already pinned to the latest published versions**: iroh 1.0.3, iroh-docs 0.101.0, iroh-blobs 0.103.0, iroh-gossip 0.101.0. **There is no newer release to upgrade to.** The upgrade path is "wait for the next iroh-docs release (will include #110) and re-test", or pin to iroh-docs `main` to pick up #110 now — neither addresses the browser-sync gap, which remains a no-issue, no-fix, no-wasm-test situation.

---

## (a) Existing upstream issue? — None. Draft + filing target.

### Search evidence (2026-08-14)

GitHub issue search over `n0-computer/iroh-docs` and `n0-computer/iroh`:

| Query (repo-scoped) | Hits |
|---|---|
| `iroh-docs type:issue wasm` | 0 |
| `iroh-docs type:issue browser` | 0 |
| `iroh-docs wasm sync` / `iroh-docs "start_sync"` | only PRs #75, #84 (the wasm build work) |
| `iroh-docs "Failed to establish connection"` | 0 |
| `iroh type:issue wasm docs` / `wasm sync` / `browser docs sync` | 0 (only #2799 tracking, #3344, #4251) |
| `iroh "Failed to establish connection"` | 5, none wasm/browser (see "closest neighbors") |

No GitHub **discussion** covering browser docs sync either (discussion #3200 is build/toolchain troubleshooting only).

### Closest existing issues (relay/sync reliability family, all native)

- **iroh-docs #51** — "Syncing fails with iroh_docs 0.91.0 but works in 0.35": second join gets `InsertRemote` but the content blob never downloads. Open since 2025-08-06. (Native; blob-download path, not connection establishment.) https://github.com/n0-computer/iroh-docs/issues/51
- **iroh-docs #74** — "Lost connection to relay server" on router restart + rejoin. Open since 2025-10-22. (Native; relay reconnect path.) https://github.com/n0-computer/iroh-docs/issues/74
- **iroh #4319** — "Endpoint unreachable ~30 s on home relay failure despite multiple relays configured": inbound relay dials fail while the endpoint only keeps its single home relay connection; bare-`EndpointId` dials and multi-relay failover are fragile. Open, labeled bug, Jun 2026. This is the closest iroh-side root cause for "engine dials `EndpointAddr::new(peer)` and relies on lookup". https://github.com/n0-computer/iroh/issues/4319
- **iroh-docs #64/#66/#68/#61** — open flaky-sync tests (`sync_big`, `sync_full_basic`, `sync_restart_node`). Evidence upstream itself treats the sync engine's determinism as a known problem. e.g. https://github.com/n0-computer/iroh-docs/issues/64

**Conclusion: (a) no upstream issue; file one.** None of these is about wasm/browser. The browser case is distinctive because (per S7) the engine's own dial (`connect_and_sync` → `EndpointAddr::new(peer)`, no relay URL from the ticket) depends on address lookup that is nondeterministic in wasm, while the app's own relay-address dials always succeed.

### Where to file

**Primary: `n0-computer/iroh-docs`** (New Issue) — the docs engine (`engine/live.rs` sync dial), the memory-store wasm build, and the `wasm_build` CI job all live there. Cross-link **iroh #4319** (endpoint/relay lookup behavior) and **iroh-docs #51** (sync engine nondeterminism in the same family). Reference the iroh repo `wasm_test`/iroh-docs `wasm_build` gap (no browser runtime sync test) as the reason this slipped.

### Draft issue text (copy-paste ready)

```markdown
Title: Browser (wasm) docs sync is nondeterministic: `start_sync` mostly fails
with "Failed to establish connection" over a working relay

## Summary

On the wasm build (iroh 1.0.3 + iroh-docs 0.101.0, wasm32-unknown-unknown via
wasm-bindgen, default-features off), two browser tabs connected to the n0
public relay over WebSocket rarely complete a docs sync. After
`import_ticket` + `Doc::start_sync(ticket.nodes)`:

- `get_sync_peers()` stays empty, and
- the `SyncFinished` live event arrives with `result: Err("Failed to
  establish connection")` the vast majority of the time.

One sync DID complete (both sides exchanged a record), so the codec path is
not broken — the connection establishment feeding it is nondeterministic.

## Repro (two browser tabs, same origin)

Tab A: `Endpoint::builder(presets::N0).alpns([blobs, gossip, docs]).bind()`,
spawn `Docs::memory()`, create doc, `start_sync(vec![])`,
`share(Write, AddrInfoOptions::RelayAndAddresses)` → ticket.
Tab B: import the ticket, dial the ticket's nodes explicitly with the embedded
relay URL (`endpoint.connect(peer, docs::ALPN)`) — this reliably connects —
then call `doc.start_sync(ticket.nodes)` and subscribe.

Observed (8 retries over ~16 s, relay connection confirmed up):
- direct relay-URL dial of the peer: succeeds every time (`connected 1 peer(s)`),
- docs-engine sync dial: fails with "Failed to establish connection" ~7/8,
- once: `SyncFinished` OK, entry delivered (`InsertRemote`), then it stops
  working again on subsequent attempts.

## Likely cause

The docs engine's `connect_and_sync` dials the peer via a bare
`EndpointAddr::new(peer)` (no relay URL from the ticket) and depends on
address lookup to resolve the relay. In the browser build that lookup path is
nondeterministic, even though the ticket's own `EndpointAddr` carries the
relay URL and dialing with it explicitly works. Related: iroh #4319
(endpoint unreachable when dialed bare / only one home relay connection
maintained) and iroh-docs #51 (sync engine nondeterminism).

## Repro asks / why this slipped

- Neither the iroh repo's `wasm_test` CI job (runs `cargo test -p iroh
  --test integration` only — the `iroh` transport crate) nor iroh-docs'
  `wasm_build` CI job (build + no-`import "env"` skeleton check only) runs
  a docs sync test in a browser runtime. Adding one (two in-process wasm
  nodes over the public staging relay, ticket import + start_sync +
  assert entry delivery) would have caught this.
- Please confirm whether `connect_and_sync` should pass the peer's relay
  URL (from the ticket) instead of relying on address lookup, and whether
  the wasm address-lookup path is expected to be reliable.

## Environment

- iroh 1.0.3, iroh-docs 0.101.0, iroh-blobs 0.103.0, iroh-gossip 0.101.0
- wasm32-unknown-unknown + wasm-bindgen, `getrandom_backend="wasm_js"`
- n0 public relay (`euc1-1.relay.n0.iroh.link`), WebSocket transport
- Chrome, two tabs, same browser profile
```

---

## (b) Releases since 0.101 + wasm CI status

### iroh-docs releases (crates.io) — 0.101.0 is still the latest

| Version | Date | Notes (relevance to browser sync) |
|---|---|---|
| **0.101.0** | 2026-06-15 | redb 2.x tuple-table migration fix; deps to iroh 1.0 / iroh-blobs 0.103 / iroh-gossip 0.101. **No browser-sync fix.** |
| 0.100.0 | 2026-05-27 | breaking: iroh@1.0.0-rc.1; ed25519→iroh-base migration |
| 0.99.1 | 2026-05-26 | `EntrySignature` wire format locked |
| 0.99.0 | 2026-05-08 | 1.0.0-rc.0 deps; redb@4; `MAX_TIMESTAMP_FUTURE_SHIFT` microseconds fix (#99) |
| 0.98.0 | 2026-04-20 | iroh@0.98 deps |
| 0.97.0 | 2026-03-17 | **first wasm release** (merged `feat: build on wasm` #75, 2026-02-24) |

Source: https://github.com/n0-computer/iroh-docs/blob/main/CHANGELOG.md and
https://crates.io/crates/iroh-docs (max_version `0.101.0`, 2026-08-14).

### Commits on `main` since 0.101.0 (only two; one functional)

- `b53c3179` "fix: don't abort receive loop on invalid message" (**PR #110**, merged 2026-07-15) — on a decode failure over gossip the engine aborted the whole topic's receive loop; now skips the message. Robustness against a malicious/broken peer — plausibly relevant to browser flakiness but **unreleased**.
- `ad80e691` "chore: run scheduled CI jobs earlier" (#115, 2026-07-30) — CI only.

**Open PRs touching sync:**
- **#112** "fix(sync): retry missing content downloads on every successful sync" (open, 2026-07-15) — content (blob) download retry; addresses the "record arrives but bytes never download" failure (same family as iroh-docs #51). Not connection establishment.
- **#93** "fix(store): bound MemPublicKeyStore cache to prevent memory exhaustion" (open, 2026-04-12) — unbounded pubkey cache; relevant to long-lived browser sessions.

**Verdict (b): no release since 0.101.0 has shipped a browser-sync fix, and none is even released yet.** The only candidate (#110) is on `main`, unreleased.

### Wasm CI — S1 correction

- **iroh-docs `ci.yaml` has a `wasm_build` job ("Build & test wasm32")** that has existed **since the wasm feature itself** (added in commit `bf1fc328`, the `#75` merge, 2026-02-24; refined by `#100`, 2026-05-08): `RUSTFLAGS='--cfg getrandom_backend="wasm_js"'`, `rustup target add wasm32-unknown-unknown`, `cargo build --target wasm32-unknown-unknown --no-default-features`, then `wasm-tools print --skeleton` must not contain `import "env"`. **S1's "no wasm CI job" is inaccurate** — but note the job is **build + leak-check only; it runs zero docs-sync tests** in a browser or Node.
- **iroh repo `wasm_test` job** (the one S1 cited) is unchanged: Node 22.5, wasm-bindgen-cli 0.2.122, builds `iroh-base`/`iroh-relay`/`iroh`, then `cargo test -p iroh --test integration --target wasm32-unknown-unknown` — the **iroh transport crate only**, no iroh-docs/i
roh-gossip/i
roh-blobs sync tests.
- So upstream, **no CI anywhere runs a docs sync in a browser/wasm runtime.** That remains the single most actionable gap for a PR once the issue above is filed.

---

## (c) Native relay-side participant / browser gateway — maturity

### The architecture is officially recommended…

The wasm-browser docs literally prescribe it: *"We envision that most
applications will use iroh browser support as an additional feature to
complement existing deployments to desktops, native apps or servers."*
(https://docs.iroh.computer/languages/wasm-browser). A browser node is
relay-only (WebSocket, E2E-encrypted, no hole punching); a native node does
full hole punching + persistent `Docs::persistent(path)` / `FsStore::load`.
A native participant that imports the same `DocTicket`, keeps a persistent
doc, and stays online is exactly the store-and-forward peer browsers dial
over the relay. Building blocks are **GA**: iroh 1.0.3, iroh-docs 0.101.0
(native is the crate's primary, fully tested path).

### …but there is NO off-the-shelf gateway component

| Option | Status | Fit |
|---|---|---|
| **Rust daemon using iroh-docs native** | Fully supported, mature. This is the only official way to run iroh-docs today. | **Best fit.** Small always-online binary; `Docs::persistent`; import ticket; reconcile. Effort is ours. |
| **iroh CLI / `iroh node`** | **Abandoned.** `iroh-cli` last release 0.28.1 (2024-11-04), pre-1.0; no CLI ships in the 1.x repo (no `iroh-cli` dir in n0-computer/iroh). | ❌ Not usable for 1.0. |
| **Node.js via `@number0/iroh` 1.1.0 (NAPI)** | Official, but **iroh-docs is out of scope**: iroh-ffi README states *"higher-level protocols not yet at 1.0 (`iroh-blobs`, `iroh-docs`, `iroh-gossip`) are out of scope."* Raw endpoint/tickets/ALPN/streams only. | ❌ Cannot run a docs participant from official Node bindings. |
| **`iroh-gateway` example** (n0-computer/iroh-examples) | Official HTTP gateway around a native iroh node — but it serves **blob content** (range requests, video streaming), not docs records. | ◐ Closest official analog (native node + server); wrong protocol layer for us. |
| **`browser-chat` example** | Official, **deployed live** (https://n0-computer.github.io/iroh-examples/main/browser-chat/index.html): the same shared Rust `ChatNode` runs in a browser (wasm) **and** a CLI, peers share a channel over iroh-gossip. | ◐ Proves the browser+CLI-hybrid topology for gossip; docs is the next layer up. |
| **WebRTC/WebTransport direct browser links** | Experimental/community: `iroh-webrtc-transport` 0.1.0-alpha.2 (2026-05-02, ~25 downloads, non-n0 repo). iroh issue #2799/#2671 track WebTransport/WebRTC as roadmap. | ❌ Too early; also not needed if a native participant exists. |
| **iroh-ts** (community wasm bindings, iroh v0.97) | SalvatoreT/iroh-ts, 2026-03-22: TS bindings, docs sync "in Node.js or the browser" — but built on **pre-1.0 iroh 0.97** and the same wasm runtime reliability caveats. | ⚠️ Not an upgrade; pre-1.0. |

Community temperature (Automerge newsletter, 2026-07-31): *"Sadly iroh doesn't
support the browser well yet, but our early tests for desktop and mobile
applications have been very promising."* — consistent with keeping browser
sync experimental and betting on a native peer.

### Caveat that applies to the native participant too

iroh #4319 (open): even a native node that is **relay-only** (e.g. behind a
NAT with hole punching failing) only keeps its single **home** relay
connection; inbound dials can fail for ~30 s when that relay drops, and bare-`EndpointId`
dials are fragile. A native participant should therefore (a) also run with
`RelayAndAddresses`-style tickets, (b) be monitored with retries, and (c) if
self-hosted, consider a custom relay map. Not a blocker; a known failure mode.

### Maturity verdict (c)

**Pattern is sound and cheap to build (Rust), but must be built by us — no
off-the-shelf iroh-docs gateway or CLI exists.** Transport + native iroh-docs
are GA; the missing piece is a small daemon (persistent doc + always-online)
and the app plumbing to point browser nodes at it. This matches the S6 map's
"big fork" note: it's a real product decision, not a config flag.

---

## (d) Version pin + upgrade path

### Current pin (confirmed from the repo)

`crates/spectre-sync/Cargo.toml`:
```toml
iroh        = { version = "1",             default-features = false, features = ["tls-ring"] }
iroh-blobs  = { version = "0.103",         default-features = false }
iroh-docs   = { version = "0.101",         default-features = false }
iroh-gossip = { version = "0.101",         default-features = false }
```
`crates/spectre-sync/Cargo.lock` resolves: **iroh 1.0.3 · iroh-docs 0.101.0 ·
iroh-blobs 0.103.0 · iroh-gossip 0.101.0**.

These are **exactly the latest published versions** (checked 2026-08-14):
iroh 1.0.3, iroh-docs 0.101.0, iroh-blobs 0.103.0, iroh-gossip 0.101.0.

### Upgrade path — verdict

- **There is no newer iroh-docs release to upgrade to.** 0.101.0 is current.
- The **only** unreleased functional fix on iroh-docs `main` is #110
  (receive-loop robustness, merged 2026-07-15). It *might* improve wasm sync
  determinism (it changes how the gossip-driven engine reacts to bad
  messages) but it is not a browser-sync fix and is unreleased.
- Options, in order of preference:
  1. **Stay pinned; re-test on the next iroh-docs release** (will include #110).
  2. **Pin `iroh-docs` to a git rev of `main`** to get #110 now — low-risk
     (a one-commit delta) but still not a fix for the browser-sync gap.
  3. **Do not expect an upgrade to fix it**: the gap is un-filed, unfixed,
     and un-tested upstream (see (a)/(b)). Plan around it (experimental flag;
     native participant per (c)) rather than waiting on a release.
- Keep the wrapper's existing best-effort mitigations (ALPN advertisement,
  `RelayAndAddresses` tickets, relay-URL dials, `ensure_online`, `start_sync`
  retry) — they are the correct iroh-side behavior and remain valid against
  1.0.x.

---

## Sources (cited 2026-08-14)

- iroh-docs CHANGELOG + release tags: https://github.com/n0-computer/iroh-docs/blob/main/CHANGELOG.md · https://github.com/n0-computer/iroh-docs/releases
- iroh-docs versions (crates.io): https://crates.io/crates/iroh-docs (max 0.101.0)
- iroh / iroh-blobs / iroh-gossip versions (crates.io): iroh 1.0.3, iroh-blobs 0.103.0, iroh-gossip 0.101.0
- iroh-docs `wasm_build` CI job (present since #75, 2026-02-24): https://github.com/n0-computer/iroh-docs/blob/main/.github/workflows/ci.yaml#L281
- iroh `wasm_test` CI job (iroh crate only): https://github.com/n0-computer/iroh/blob/main/.github/workflows/ci.yml#L292
- iroh-docs commits since 0.101: #110 (`b53c3179`, merged 2026-07-15) https://github.com/n0-computer/iroh-docs/pull/110 · #115 (`ad80e691`) · open PRs #112 https://github.com/n0-computer/iroh-docs/pull/112 · #93 https://github.com/n0-computer/iroh-docs/pull/93
- Nearest existing issues: iroh-docs #51 https://github.com/n0-computer/iroh-docs/issues/51 · iroh-docs #74 https://github.com/n0-computer/iroh-docs/issues/74 · iroh-docs flaky #64/#66/#68 · iroh #4319 https://github.com/n0-computer/iroh/issues/4319 · iroh wasm tracking #2799
- Browser guidance + no-npm-package + relay-only + native-complement stance: https://docs.iroh.computer/languages/wasm-browser
- iroh-docs protocol docs (no wasm mention): https://docs.iroh.computer/protocols/documents
- JS/FFI bindings + "blobs/docs/gossip out of scope": https://docs.iroh.computer/languages/javascript · https://github.com/n0-computer/iroh-ffi (README) · https://registry.npmjs.org/@number0/iroh (1.1.0)
- iroh-cli abandoned: https://crates.io/crates/iroh-cli (0.28.1, 2024-11-04)
- Examples: iroh-gateway (blob HTTP gateway) and browser-chat (browser+CLI gossip, deployed) in https://github.com/n0-computer/iroh-examples
- iroh-webrtc-transport (community alpha): https://crates.io/crates/iroh-webrtc-transport (0.1.0-alpha.2)
- iroh-ts (community wasm bindings, iroh 0.97): https://github.com/SalvatoreT/iroh-ts
- Community temperature (Automerge newsletter, 2026-07-31): https://automerge.org/blog/2026-july/
- Repo pins verified in: `crates/spectre-sync/Cargo.toml` and `crates/spectre-sync/Cargo.lock`
