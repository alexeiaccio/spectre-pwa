---
id: B1
title: Background/periodic sync feasibility in a browser PWA
type: research
status: closed
blocked_by: []
assigned: research subagent
---

## Question

The Sync effort deliberately shipped **foreground-only** sync (app open + online). This ticket charts what the browser actually offers for "sync happens without the user doing anything", so the effort lands the achievable subset. Establish:

1. **Service worker mechanisms** — `navigator.sync` (Background Sync), `Periodic Background Sync` (`periodicsync`), `background-fetch`: what fires them, browser support, trust/permission model (how often, when), and whether a SW can do *anything useful* for this app. Key constraint to test: iroh runs as **wasm in the page** (relay WebSocket) — can it run in a SW scope at all (wasm instantiation, persistent WebSocket, no DOM), and even if it can, does waking the SW to sync beat just syncing on next launch?
2. **Page-lifecycle triggers** — `online`/`offline`, `visibilitychange`, `pageshow`/`focus`: which fire when, and which are cheap + reliable enough to drive a `syncNow()` flush. Compare with an in-app timer while the app is open (interval, and what interval is defensible for a P2P relay).
3. **The offline change queue** — today an offline edit persists to the IndexedDB v3 mirror but the outbound `pushSave` is lost. Chart the minimal queue: how the mirror/bridge knows a change is unsynced, what marks it synced after a flush, and how it degrades when live delivery is still behind `SYNC_EXPERIMENTAL` (S7/M2).
4. **UX tie-in** — the sync map's deferred "sync status UX" (last-synced at, pending changes, relay reachability): does the pending-queue design give it its "pending changes" signal for free?
5. **Recommendation** — the sync-bg architecture: which mechanisms to use, which to rule out (with sources), and the landing order given the experimental live-delivery flag.

Deliver findings as a research note at `.wayfinder/sync-bg/research/B1-periodic-sync-feasibility.md`, citing sources, and flag anything that contradicts the standing constraints (iroh-in-page only, foreground bridge today, no WebRTC/native).

## Resolution

Research note: `.wayfinder/sync-bg/research/B1-periodic-sync-feasibility.md` (2026-08-15).

**Verdict — "sync without user action" = wake-the-page, capped at page lifetime.** (1) A SW **cannot run the iroh wasm node** — wasm/fetch/WebSocket/IndexedDB all exist in a SW scope, but the SW's event-driven lifetime kills the long-lived relay WebSocket + in-memory doc state; a SW is at most a wake-up bell. (2) **One-off Background Sync** (`navigator.sync`/`sync` event) is Chromium-only (Chrome/Edge 49+, Android; Firefox has a negative standards position, WebKit bug 182565 still NEW) but has no install/engagement/permission gate and fires on connectivity. **Periodic Background Sync** is Chrome-only, requires an **installed + engaged** PWA and the `periodic-background-sync` permission, and floors at **12 h** (spec default) — not a delivery guarantee. (3) `online`/`visibilitychange→visible`/`pageshow` plus an in-page timer while the app is open are the reliable cross-platform triggers (iOS Safari gets no background sync at all — the "sync when you open the app" baseline). Hidden-tab timers throttle to ~1/min (Chrome M109+). (4) The pending-changes queue lives in the existing IndexedDB v3 mirror — page and SW share the same DB — so the queue needs only a pending/dirty marker, and it doubles as the "pending changes" signal for the deferred sync-status UX.

**Recommendation.** Ship **(a)** pending-changes queue + flush on `online`/`visible`/launch/in-app timer (cross-platform, incl. iOS), **(b)** a visible-app periodic ticker, and **(c)** a Chromium-only SW `sync` handler that wakes the page via `postMessage` (progressive enhancement, no architecture change if a `periodicsync` swap is wanted later). **Periodic Background Sync = out of scope.** `navigator.onLine` is a hint, not truth — the relay WebSocket is the real connectivity oracle. Background/periodic wakes are orthogonal to the S7 live-delivery nondeterminism.
