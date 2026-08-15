# Spectre Pocket Sync-bg — Background & Periodic Sync — Wayfinder Map

> Map issue · local markdown tracker · label: `wayfinder:map`
> Effort dir: `.wayfinder/sync-bg/` — map, tickets, research, prototypes live here.
> Tracking conventions: see `.wayfinder/README.md`.

## Destination

Turn the Sync effort's **foreground-only** sync into **eventually-consistent cross-device sync that needs no user action**, within the browser sandbox: an **offline change queue** (edits made while offline are marked pending and flushed on the next opportunity) plus **periodic in-app sync** (timer while the app is open, `online` + `visibilitychange` triggers), and a decision on whether the **service worker** (Background Sync / Periodic Background Sync) can add anything on top. The service-worker path is suspect up front — iroh runs as wasm in the page and cannot hold a relay connection from the SW scope — so B1 charts what is actually possible, and the effort lands the achievable subset. Sync **status UX** (last-synced at, pending changes, relay reachability — deferred from `.wayfinder/sync/map.md`) becomes meaningful once this lands.

## Notes

- Domain: PWA/service-worker lifecycle, IndexedDB, iroh-in-browser wasm, offline-first vault UX.
- Skills sessions should consult: `wayfinder`, `grill-with-docs`, `prototype`, `research`, `code-review`, `vkvideo-testing`, `vkvideo-pwa`.
- Built on delivered **Sync** (`.wayfinder/sync/map.md`) + **S6** (`.wayfinder/s6/map.md`): `src/lib/sync/` bridge/adapter/records, DB v3 mirror, `syncNow`/`pushSave` behind `SYNC_EXPERIMENTAL`.
- Standing constraints from prior research (do not re-litigate):
  - **iroh-docs browser sync is experimental** (S7/M2, upstream reliability) — live delivery stays behind the flag; `mergeIncoming` inbound is the seam that periodic sync would drive.
  - iroh is **wasm in the page** — relay WebSocket only, and a page close drops the connection; the durable mirror is IndexedDB v3 (offline edits already land in the mirror, the *push* is what's lost).
  - **Out of scope, carried over**: WebRTC/direct connections; background sync while the page is fully closed via a native process (only the SW mechanism exists, and it can't host iroh); cross-user sharing.
- The pending-queue + status-UX problem is shared with the sync map's "Not yet specified" note — B-series research should keep it in scope rather than splitting it.

## Tickets

- [B1 · Background/periodic sync feasibility in a browser PWA](tickets/B1-periodic-sync-feasibility.md) — chart what the browser actually offers (SW Background Sync / Periodic Background Sync, `online`/`visibilitychange`, in-app timer), where iroh-in-wasm blocks the SW path, and recommend the sync-bg architecture.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [B1 · Background/periodic sync feasibility](tickets/B1-periodic-sync-feasibility.md) — **Done (research).** A SW cannot host iroh (event-driven lifetime kills the relay WS) — background sync is capped at *wake-the-page*. One-off Background Sync = Chromium-only, no gates, fires on connectivity; Periodic Background Sync = Chrome-only, installed+engaged PWA, ≥12 h floor — **out of scope**. Cross-platform engine = **pending-changes queue in the v3 IndexedDB mirror + flush on `online`/`visible`/launch/in-app timer**, plus a Chromium-only SW `sync` handler that postMessages the page to re-dial the relay. iOS/Firefox baseline = "sync on open/foreground". Queue doubles as the pending-changes signal for sync-status UX.

## Out of scope

- Making **live** sync reliable — that's S7/M2 (upstream iroh-docs).
- Native/OS background execution (mobile share targets, PWA `background-fetch` for downloads) — nothing to fetch here.
- Any new sync protocol — this effort only decides *when* to run the existing bridge.
