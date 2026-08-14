---
id: N1
title: solid-router fit for this deployment
type: research
status: closed
blocked_by: []
assigned: dev
---

## Question

Investigate @solidjs/router and collect the facts N4 (router adoption) needs to decide:

- (a) **Current version line and SolidJS 2 (beta) compatibility** — does any published version target `solid-js` 2.x, or is the router still 1.x-only? Which beta/rc channels exist?
- (b) **hash-mode vs history-mode under THIS deployment** — Cloudflare Worker serving `dist/` with `assets.not_found_handling = "single-page-application"` (`wrangler.toml:16`) + workbox `navigateFallback` (vite.config.ts). Will history-mode routes 404 at the worker, or be app-shelled? Is hash-mode safer for an installable PWA (icon, `start_url`, scope)?
- (c) **Feature fit**: route guards/redirects (locked/booting must force the locked screen), nested routes + outlets, params, lazy. Can routing cover only the outer shell (setup/locked/identities) while identity detail stays in internal state — or does the library force one routing model?
- (d) **Bundle cost** of the router vs a hand-rolled Screen module + thin URL adapter.
- (e) **Comparison to hand-rolling**: a Screen module (pure derived union) + optional thin adapter over `history.pushState` / `hashchange`, ≈ zero deps.

Write findings to `.wayfinder/routing/research/N1-solid-router-fit.md`. Cite versions, dates, and sources. Note any blockers (unmaintained, Solid-2-incompatible, workbox conflict).

## Resolution

Findings at `research/N1-solid-router-fit.md` (all facts read from npm registry, published tarballs, installed workbox source, and the repo's own `dist/sw.js`).

- **No stable Solid-2 router exists.** `latest` = 1.0.0 (Solid 1.x-only, peer `solid-js ^1.8.6`); the Solid-2 line lives only on `next` = **2.0.0-next.16** (peer `solid-js ^2.0.0-rc.0` + `@solidjs/web ^2.0.0-rc.0`), API differs from its own docs (README ≠ package), open params bug PR #566.
- **Deploy is 404-free in both modes** — CF `single-page-application` serves `index.html` 200 and workbox `navigateFallback` serves the precached shell for every navigation (verified in `dist/sw.js` + workbox source). Hash-mode remains the lower-risk default (zero dependence on fallback plumbing; fragment never leaves the client).
- **Guards are app-state** — the 2.0-next router has no declarative guard API; locked/booting enforcement stays in the derived Screen union. Partial routing is fine (catch-all owns identity-detail internal state).
- **Cost**: ≈ +11 KB gz eager (+12 KB gz precached-lazy) vs ≈ 0.5–1.5 KB gz for a hand-rolled adapter (~30–80 LOC, 0 deps).
- Adopting now forces `solid-js`/`@solidjs/web` → rc.0 + `vite-plugin-solid` → 3.0.0-next.27; a fresh install lands there anyway.
- Consumed by N4 (adopt router on `next` now — human's call, overrode the research's lean toward "seam + adapter now, revisit at stable").
