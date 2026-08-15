# B1 — Periodic & background sync feasibility for iroh-in-page

**Date:** 2026-08-15 · **Status:** Decision-ready · **Scope:** Background/periodic sync mechanisms (Background Sync, Periodic Background Sync, page-lifecycle triggers) vs. the standing constraint that **iroh runs as wasm in the page** (relay WebSocket only) with the durable mirror in **IndexedDB v3** and live sync delivery **experimental + foreground-only** · **Repo:** `/Users/a.tukachev/github/spectre-pwa`

---

## Verdict (short answer)

"Sync without user action" is **partially achievable, but not via a service worker running iroh** — and not at all on iOS/Safari or Firefox in the background.

- ✅ **One-off Background Sync** (`navigator.sync`/`sync` event): Chromium-only (Chrome/Edge 49+, incl. Android). Firefox and Safari have **not shipped it** (WebKit's SyncManager bug is still open as of 2026-07; Firefox has a negative standards position). It fires "as soon as network connectivity is available," works in the background after the page closes, and requires only a registered, active service worker + secure context — **no installed-PWA gate, no engagement gate, no user prompt**.
- ⚠️ **Periodic Background Sync** (`navigator.periodicSync`/`periodicsync`): Chrome 80+ only. **Requires an installed PWA**, the **`periodic-background-sync` permission**, and Chrome's **site-engagement model**: events don't fire at all below engagement > 0, and the real cadence is engagement-driven on top of a hard **12-hour** floor (spec default `43200000` ms). Firefox/Safari: none (WebKit Periodic bug is WONTFIX).
- ❌ **A service worker cannot run the iroh wasm sync layer.** SWs are event-driven, killed when idle, restarted per event; the iroh node's relay WebSocket + in-memory doc state live in the page. A SW can at most **notify the page** (wake a client) or pre-check/pre-cache. Wasm itself *is* available in the SW scope (worker global, no DOM; WebSocket/fetch/IndexedDB all present) — the blocker is **lifetime**, not capability.
- ✅ **The realistic subset needs no service worker at all:** a pending-changes queue in the same IndexedDB v3 mirror + flush on `online` / `visibilitychange→visible` / app launch (`pageshow`) / an in-app timer while the app is open. This is the cross-platform (incl. iOS) baseline.
- 🎯 **Recommended architecture:** queue + event-driven flush in the page for everyone, plus a **progressive-enhancement SW `sync` handler on Chromium** that wakes the page (postMessage) so the page's iroh node reconnects and flushes. Periodic Background Sync is **not worth building on** — Chrome-only, engagement-gated, ≥12 h, and it cannot deliver anything the one-off `sync` wake + engagement logic doesn't already give a vault app.

No claims below contradict the standing constraints; the one constraint they **sharpen** is that "background sync" can only ever mean "wake the foreground iroh node earlier" — the wasm-in-page architecture is the ceiling, and on Firefox/iOS the ceiling is "sync when the app is opened or foregrounded."

---

## 1. Service-worker sync mechanisms

### 1a. Background Sync API (`navigator.sync` / `sync` event)

**What it does.** The Background Synchronization API "enables a web app to defer tasks so that they can be run in a service worker once the user has a stable network connection" (MDN, [Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)). `SyncManager.register(tag)` "registers a synchronization event, triggering a sync event inside the associated service worker as soon as network connectivity is available" (MDN, [SyncManager.register](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager/register)). The WICG spec: "Whenever the user agent changes to online, the user agent SHOULD fire a sync event for each sync registration whose registration state is pending," and the event "is considered to run in the background if no service worker clients whose frame type is top-level or auxiliary exist for the origin" — i.e. it is designed to fire after the page is gone ([WICG Background Sync spec](https://wicg.github.io/background-sync/spec/)). "`sync` will fire when the user agent believes the user has connectivity"; a rejected `waitUntil` promise reschedules with UA backoff; `lastChance` marks the final attempt ([WICG explainer](https://github.com/WICG/background-sync/blob/main/explainers/sync-explainer.md)).

**When it fires.** On connectivity change → fire for pending registrations. "If the page (or worker) that registered the event is running, the user agent will fire the sync event as soon as network connectivity is available. Otherwise, the user agent should run the event at the soonest convenience" (spec Note, [wicg.github.io/background-sync/spec](https://wicg.github.io/background-sync/spec/)). Not on a fixed timer.

**Secure context + SW required.** "As this API relies on service workers, functionality provided by this API is only available in a secure context" ([MDN Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)); the explainer is explicit that service workers are a hard requirement and HTTPS is required. `register()` rejects if "the current service worker is not active" ([MDN SyncManager.register](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager/register)). One catch for our shape: registering **from the SW itself** fails when "there's no top-level window open for the origin" (privacy guard) — so registration happens from the page, then the event can fire in the background ([WICG explainer](https://github.com/WICG/background-sync/blob/main/explainers/sync-explainer.md); the reason is "we don't want sync events to keep reregistering themselves forever when they're in the background" — [WICG/BackgroundSync#147](https://github.com/WICG/BackgroundSync/issues/147)).

**Trust/permission model.** No permission prompt, no install gate, no engagement gate for one-off sync (unlike periodic, §1b). The explainer warns the reverse way: "Browsers may choose to limit the set of applications which can register for synchronization based on quality signals that aren't a part of the visible API" — i.e. Chrome may simply not fire it for low-trust sites; and a user can disable "Background Sync" for the site (register rejects with "background sync has been disabled by the user", [MDN SyncManager.register](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager/register)).

**Browser support — Chromium vs Firefox vs Safari.**

| Engine | `navigator.sync` / `SyncManager` | Status |
|---|---|---|
| Chrome / Edge (desktop + Android) | ✅ 49+ | Supported; the only real implementation. |
| Firefox (incl. Android) | ❌ | Not shipped. Mozilla concluded a **negative standards position** on background sync ("We have a negative standards-position on single-shot background sync … this bug was integral to arriving at that conclusion") — [bugzilla.mozilla.org/1564436](https://bugzilla.mozilla.org/show_bug.cgi?id=1564436). |
| Safari / iOS | ❌ | No `ServiceWorkerRegistration.sync`/`SyncManager`. WebKit feature bug for the SyncManager interface is still **NEW** as of 2026-07 ([bugs.webkit.org/182565](https://bugs.webkit.org/show_bug.cgi?id=182565)); MDN/caniuse list it unsupported and "not Baseline" ([caniuse background-sync](https://caniuse.com/background-sync)). |

**On the "Safari `sync` event with no `navigator.sync` API" premise:** Safari exposes no registration API, so nothing can be *registered* and a `sync` handler in a Safari SW is inert for our purposes. The "sync fires on SW startup in Safari" behaviour seen in the wild is **Workbox's own emulation** (queue replay "every time the service worker starts up", [developer.chrome.com/docs/workbox/modules/workbox-background-sync](https://developer.chrome.com/docs/workbox/modules/workbox-background-sync)) plus SW-startup events, not Safari dispatching a platform `sync` event. Treat Safari as **no background sync, period**. (Corroborated by the well-documented iOS failure mode: "the queue is created but requests never get replayed" — [GoogleChrome/workbox#2736](https://github.com/GoogleChrome/workbox/issues/2736).)

### 1b. Periodic Background Sync (`navigator.periodicSync` / `periodicsync`)

**What it does.** "Provides a way to register tasks to be run in a service worker at periodic intervals with network connectivity." The `minInterval` is a **minimum**; "the user agent might also take into account other factors… previous website engagement, or connection to a known network" (MDN, [Web Periodic Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API)). "The actual interval at which periodicsync events are fired MUST be greater than or equal to this" (spec §4.1, [wicg.github.io/periodic-background-sync](https://wicg.github.io/periodic-background-sync/)).

**The 12-hour / budget model.** If the UA defines nothing, "these are set to 43200000, which is twelve hours in milliseconds" for both the per-origin and cross-origin minimum gaps (spec §4.3). The effective per-origin interval is "the minimum periodic sync interval for any origin + some user agent defined amount… The user agent defined amount could be based off the amount of engagement the user has with the origin" (spec §4.2). The scheduler only fires while online and "should consider other factors such as user engagement with the origin, and any user indications to temporarily reduce data consumption" (spec §6 + §7.1, [wicg.github.io/periodic-background-sync](https://wicg.github.io/periodic-background-sync/)). So the real cadence is engagement-tuned, **never below 12 h**, and often much longer.

**Chrome's engagement + install model.** "A web app can only use periodic background sync after a person has installed it on their device, and has launched it as a distinct application. Periodic background sync is not available in the context of a regular tab in Chrome." Chrome uses the **site engagement score** (`about://site-engagement/`): "a `periodicsync` event won't be fired at all unless the engagement score is greater than zero, and its value affects the frequency at which the `periodicsync` event fires… If the person stops frequently interacting with the app, periodic background sync will stop triggering." Background activity only happens on networks the device has previously connected to ([developer.chrome.com/docs/capabilities/periodic-background-sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync)).

**Permission + registration requirements.** Requires a service worker, secure context, the `periodic-background-sync` permission, an **active worker**, and a **foreground window at registration time**: `register()` rejects with `InvalidStateError` if the active worker is null, `NotAllowedError` if the `periodic-background-sync` permission isn't granted, and `InvalidAccessError` if called while the origin has no top-level/auxiliary client (spec §8.3, [wicg.github.io/periodic-background-sync](https://wicg.github.io/periodic-background-sync/)). Query the permission via `navigator.permissions.query({ name: 'periodic-background-sync' })` (Chrome docs, same URL).

**Browser support.** Chrome/Edge 80+ (incl. Android); **no Firefox, no Safari** — WebKit's Periodic Background Sync feature request is **WONTFIX** ([bugs.webkit.org/204117](https://bugs.webkit.org/show_bug.cgi?id=204117)); MDN lists it as supported in "only one current engine" ([MDN PeriodicSyncManager](https://developer.mozilla.org/en-US/docs/Web/API/PeriodicSyncManager)).

### 1c. Can wasm run in a service worker?

**Yes — capability-wise.** A service worker "is an event-driven worker registered against an origin and a path"; the `ServiceWorkerGlobalScope` "represents the global execution context of a service worker" and is a worker global (no DOM; "synchronous XHR and Web Storage cannot be used inside a service worker") (MDN, [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [ServiceWorkerGlobalScope](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)). WebAssembly is a JavaScript API — "Using the WebAssembly JavaScript APIs, you can load WebAssembly modules into a JavaScript app" (MDN, [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)) — and Web Workers (incl. SW globals) get the standard JS globals plus **Fetch API, WebSockets API, IndexedDB, Web Crypto, and the Service Worker API** itself (MDN, [Functions and classes available to Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Functions_and_classes_available_to_workers): "If a listed API is supported by a platform in a particular version, then it can generally be assumed to be available in web workers"). So `WebAssembly.instantiate`/`instantiateStreaming` (MDN, [Loading and running WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Loading_and_running)) plus `fetch` and `WebSocket` all exist in a SW scope.

**No — lifetime-wise, which is what matters for iroh.** "A service worker… can be terminated when idle to conserve memory… An active service worker is automatically restarted to respond to events, such as fetch or message" (MDN, [ServiceWorkerGlobalScope](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)). An iroh node needs a **long-lived relay WebSocket + live in-memory doc state**; the SW model is fire-an-event-then-die. WebSockets in a SW are also not durable across SW restarts (the socket dies with the SW instance — the classic W3C service-worker discussion is [w3c/ServiceWorker#947](https://github.com/w3c/ServiceWorker/issues/947)). **Conclusion: a SW cannot host the continuous iroh wasm sync layer; it can only be a wake-up bell for the page's node.**

---

## 2. Page-lifecycle triggers that don't need a service worker

### 2a. `online` / `offline` events and `navigator.onLine`

- Semantics: `navigator.onLine` — "Returns false if the user agent is definitely offline (disconnected from the network). Returns true if the user agent **might** be online" (WHATWG HTML spec, [system-state](https://html.spec.whatwg.org/dev/system-state.html)); the `online`/`offline` events fire "when the value of this attribute changes."
- `online` fires when the browser detects it has gained network access — e.g. airplane-mode off, Wi-Fi back. It does **not** fire per-request; the value only changes on connectivity transitions (MDN, [Window: online event](https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event)).
- **Reliability caveat:** "Browsers and operating systems leverage different heuristics… Therefore, this property is inherently unreliable, and you should not disable features based on the online status, only provide hints" (MDN, [Navigator.onLine](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine)). And: "This event shouldn't be used to determine the availability of a particular website. Network problems or firewalls might still prevent the website from being reached" (MDN, [Window: online event](https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event)).
- **Use in our design:** `online` = "try to sync now" trigger, **plus** the relay WebSocket's own `close`/`error` as the real connectivity signal. `navigator.onLine === false` is a trustworthy "skip it"; `true` is only "maybe" — the flush should attempt and let the WS decide.

### 2b. `visibilitychange` / `document.visibilityState`

- "Fired at the document when its visibility status changes… when the user switches browser tabs, navigates to a new page, minimizes or closes the browser, or on mobile, switches to a different app" (MDN, [Document: visibilitychange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)).
- Reliability: the transition to `hidden` "is the **last event that's reliably observable by the page**, so developers should treat it as the likely end of the user's session." The recommended pattern: persist unsaved state and stop background work on `hidden`; on `visible`, resume (MDN, same URL; and "it's always better to rely on the `visibilitychange` event to determine when a session ends" — [Page Lifecycle API, Chrome for Developers](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)).
- **This is our primary cross-platform trigger** (works on iOS Safari where SW sync doesn't): flush pending changes on `visible` (+ online check); cheaply persist a "pending flush" marker on `hidden`.

### 2c. `pageshow` / `focus`

- `pageshow` "is sent to a Window when the browser navigates to a new document": initial load, navigation, back/forward including **bfcache restore** (`event.persisted === true`), and opening a background tab; it fires after `load` (MDN, [Window: pageshow event](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event)). For a PWA this is the reliable "app launched/restored" hook — the SW-controlled shell means `pageshow` covers relaunch from the home screen.
- `focus` (window/`window.onfocus`) fires when the window gains focus — useful on desktop where a window can become focused while never leaving `visible`. On mobile the visibility model dominates; `visibilitychange` already covers foregrounding. (MDN, [Window: focus event](https://developer.mozilla.org/en-US/docs/Web/API/Window/focus_event).)
- **Use:** run the flush (or a re-sync attempt) on `pageshow` (any app open, including bfcache restores) and optionally on `focus`.

### 2d. In-page background timers (`setInterval`) when the tab is hidden

- Chrome's baseline: hidden tabs' timers are aligned to **once per second** (minimal throttling) for the first period, then **intensive throttling**: when the page has been hidden > 5 min, the timer chain (nesting ≥ 5) is checked **once per minute** (Chrome 88; conditions: hidden > 5 min, chain count ≥ 5, page silent ≥ 30 s, no WebRTC in use) — [developer.chrome.com/blog/timer-throttling-in-chrome-88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88). Chrome later reduced the hidden grace period to **~1 minute** for loaded pages ("Quick intensive timer throttling of loaded background pages", enabled by default in M109) — [groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE). Timers with nesting level < 5 are exempted from intensive throttling (chromium commit 76d9889). The HTML spec explicitly permits "a further implementation-defined length of time" before a timer runs ([WHATWG timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html)).
- **Consequence:** a periodic in-page sync timer is a **foreground-only** mechanism. Once the tab is hidden > ~1 min in Chrome, the best you get is ~1 tick/minute; Firefox/Safari throttle similarly. Do not design a background cadence around a page timer. (While *visible*, timers run normally — a 30–60 s visible-app ticker is fine.)

---

## 3. What "sync without user action" needs for iroh-wasm-in-page — and the recommendation

The iroh node, its relay WebSocket, and the doc subscription **only exist while the page lives**. "Background sync" therefore decomposes into three honest pieces:

**(a) Pending-changes queue in IndexedDB + flush on triggers — the foundation.**
- Every local record write goes to the vault's IndexedDB (v3 mirror) and is also marked **dirty/pending**. Nothing network-dependent happens at write time.
- Flush the pending set through the page's iroh node on: `online` event, `visibilitychange → visible`, `pageshow`/app launch, and an in-page timer while the app is open (e.g. 30–60 s). This is exactly the pattern the platform's own guidance recommends (persist on `hidden`, sync on reconnect/foreground — §2a/2b), and it is the **only** mechanism that works on iOS Safari and Firefox.
- Failure-tolerant: a failed flush leaves the records pending; the next trigger retries. LWW merge (S2/S3) makes retries idempotent.

**(b) In-app periodic timer while the app is open — the "live-ish" layer.**
- While the vault screen is visible, a light timer (or just the existing `online` + foreground triggers) periodically dials the relay and reconciles. This is the ceiling on iroh-in-page, and it already matches "foreground-only sync" as designed. When the tab is hidden, timer throttling (§2d) means this stops being a useful cadence — which is fine, because (a) covers the hidden period via the next foreground.

**(c) SW Background Sync that *notifies the page* — the Chromium progressive enhancement.**
- The SW **cannot run iroh** (§1c). But a SW `sync` handler (one-off Background Sync, §1a) is a legitimate **wake-up channel** on Chrome/Edge/Android: the page registers a `sync` tag whenever it has pending changes, and the SW handler calls `clients.matchAll()` + `postMessage` — the page (if alive in the background) re-dials the relay and flushes. This gives a real "sync shortly after connectivity returns even if the user didn't open the app" on Chromium only.
- **Periodic Background Sync should be explicitly out of scope for now:** Chrome-only, install + engagement-gated, ≥ 12 h minimum, and it buys nothing a one-off `sync` wake + `online`/foreground triggers don't already provide a vault app whose data changes are user-generated and infrequent. If wanted later, it's a straight swap (register `periodicsync` in the same handler) with zero architecture change.

**Recommendation.** Ship **(a) + (b)** as the cross-platform sync engine (this is "sync without user action" in the honest sense: any time the app is open or foregrounded, it syncs; the queue guarantees no writes are lost), and add **(c)** as a progressive enhancement on Chromium that turns "sync on next launch" into "sync when connectivity returns." Do **not** design around Periodic Background Sync. The "last-synced at / pending changes" UX that Sync-bg is meant to surface should read from the IndexedDB pending queue (§4), which all three mechanisms share.

---

## 4. IndexedDB: page ⇄ SW shared storage (the queue mechanism)

- **Same origin, both scopes:** "IndexedDB… follows a same-origin policy" and "this feature is available in Web Workers" — the page (`window.indexedDB`) and any worker including the SW (`WorkerGlobalScope.indexedDB`) read/write the **same databases** for the origin (MDN, [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [WorkerGlobalScope: indexedDB](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/indexedDB), [Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)). Writes are transactional and atomic (MDN, [Basic terminology](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology)); no cross-context locking is needed beyond the IDB transaction model.
- **So the SW can queue/flush by IDB alone** — a `sync`/`periodicsync` handler reads the same `spectre-pocket` v3 DB the page writes. For our shape the SW handler should be read-only (check "is anything pending") + wake the page; the page does the iroh work. This adds no new store today; at most a `pending`/`dirty` marker on the record-store or a tiny outbox object store.
- **The `periodicsync` caveat:** `periodicSync.register()` additionally requires the SW registration to exist **and** the `periodic-background-sync` permission to be granted — `NotAllowedError` otherwise (spec §8.3, [wicg.github.io/periodic-background-sync](https://wicg.github.io/periodic-background-sync/)); Chrome grants it only to installed, engaged PWAs (§1b, [developer.chrome.com/docs/capabilities/periodic-background-sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync)). One-off `sync.register()` has no permission requirement (§1a). Both require an active SW, which `generateSW` + `virtual:pwa-register` already give us (T5).

---

## 5. Flags / contradictions against the standing constraints

1. **"iroh is wasm-in-page (relay WebSocket only)" — confirmed and decisive.** A SW cannot host iroh (§1c): SW lifetime is event-driven, so any "background sync" feature can only **wake the page** to run the node. This is a hard platform ceiling, not a product choice.
2. **"Durable vault mirror is IndexedDB v3" — exactly the right substrate.** The pending-changes queue lives in the same DB, shared by page and SW (§4). No new persistence machinery is needed; only a pending/dirty marker.
3. **"Live sync delivery is experimental + foreground-only" (SYNC_EXPERIMENTAL, S7).** Background/periodic wakes only change *when* the page retries; they do not fix the engine's nondeterministic sync dial (S7). The queue-and-flush design is independent of that flag and improves foreground retry cadence regardless.
4. **Firefox and iOS Safari get nothing in the background — by platform.** The `visibilitychange`/`online`/`pageshow` flush (§2, §3a) is the only mechanism there; "sync when you open the app" must be the stated baseline on those platforms.
5. **Periodic Background Sync is not a delivery guarantee.** Engagement-gated, install-gated, ≥ 12 h, Chrome-only. It cannot be the mechanism for "sync happens soon after changes" — one-off Background Sync + page triggers can.
6. **`navigator.onLine` and `online` are hints, not truth** (§2a) — the relay WebSocket is the real connectivity oracle; treat `online` as "attempt now," never as proof the relay is reachable.

## Sources

- MDN — Background Synchronization API: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- MDN — SyncManager.register() (active-SW and disabled-SW rejections; fires on connectivity): https://developer.mozilla.org/en-US/docs/Web/API/SyncManager/register
- MDN — ServiceWorkerGlobalScope: sync event: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/sync_event
- WICG — Web Background Synchronization spec ("online → fire", background semantics, lastChance): https://wicg.github.io/background-sync/spec/
- WICG — sync-explainer (connectivity trigger, SW requirement, HTTPS, register-from-SW needs a window, quality-signal caveat): https://github.com/WICG/background-sync/blob/main/explainers/sync-explainer.md
- WICG/BackgroundSync#147 — register not allowed with no client window (privacy guard): https://github.com/WICG/BackgroundSync/issues/147
- caniuse — Background Sync (Chrome 49+, Firefox/Safari no): https://caniuse.com/background-sync
- web-platform-dx — web-features explorer, background-sync (Firefox negative position, Safari bug 182565): https://web-platform-dx.github.io/web-features-explorer/features/background-sync/
- WebKit bug 182565 — SyncManager interface, still NEW (2026-07): https://bugs.webkit.org/show_bug.cgi?id=182565
- Mozilla bug 1564436 — background sync: negative standards position: https://bugzilla.mozilla.org/show_bug.cgi?id=1564436
- Chrome for Developers — Workbox background-sync (Safari fallback = replay on SW startup; queue in IndexedDB): https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
- MDN — Web Periodic Background Synchronization API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API
- WICG — Web Periodic Background Synchronization spec (§4.3 12-h default, §5.1 permission, §6 engagement, §8.3 register errors): https://wicg.github.io/periodic-background-sync/
- Chrome for Developers — Periodic Background Sync (install requirement, engagement score, permission query, register example): https://developer.chrome.com/docs/capabilities/periodic-background-sync
- MDN — PeriodicSyncManager (Chrome-only support): https://developer.mozilla.org/en-US/docs/Web/API/PeriodicSyncManager
- WebKit bug 204117 — Periodic Background Sync, WONTFIX: https://bugs.webkit.org/show_bug.cgi?id=204117
- MDN — Service Worker API (event-driven worker, no DOM, sync XHR/Web Storage forbidden): https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- MDN — ServiceWorkerGlobalScope (idle termination/restart, worker global): https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope
- MDN — Functions and classes available to Web Workers (WebSockets, Fetch, IndexedDB, Web Crypto, Service Worker API; wasm is a standard JS global): https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Functions_and_classes_available_to_workers
- MDN — WebAssembly (JS API overview): https://developer.mozilla.org/en-US/docs/WebAssembly
- MDN — Loading and running WebAssembly (instantiate/instantiateStreaming): https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Loading_and_running
- w3c/ServiceWorker#947 — WebSocket in SW scope lifetime caveat: https://github.com/w3c/ServiceWorker/issues/947
- WHATWG HTML — Navigator.onLine semantics ("might be online") + online/offline events: https://html.spec.whatwg.org/dev/system-state.html
- MDN — Navigator.onLine (inherently unreliable): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
- MDN — Window: online event / offline event: https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event
- MDN — Document: visibilitychange event (hidden = last reliably observable state): https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
- Chrome for Developers — Page Lifecycle API (hidden-state recommendations): https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- MDN — Window: pageshow event (initial load, bfcache, persisted): https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event
- MDN — Window: focus event: https://developer.mozilla.org/en-US/docs/Web/API/Window/focus_event
- Chrome for Developers — Heavy throttling of chained JS timers in Chrome 88 (1 s minimal → 1 min intensive): https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- blink-dev — Quick intensive timer throttling of loaded background pages (M109, ~1 min grace): https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE
- WHATWG HTML — timers (implementation-defined delay): https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html
- MDN — IndexedDB API (workers + same-origin): https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN — WorkerGlobalScope: indexedDB: https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/indexedDB
- MDN — Using IndexedDB / Basic terminology (same-origin, atomic transactions): https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- GoogleChrome/workbox#2736 — iOS Safari: queue written but never replayed: https://github.com/GoogleChrome/workbox/issues/2736
