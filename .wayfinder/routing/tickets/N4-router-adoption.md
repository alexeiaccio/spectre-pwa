---
id: N4
title: Router adoption — solid-router or hand-rolled seam
type: grilling
status: closed
blocked_by: [N1]
assigned: dev
---

## Question

The pivot decision. Using N1's facts: do we **adopt @solidjs/router** (as the URL adapter for the outer shell) or **hand-roll** the navigation seam?

- What the seam's interface is (`current screen + navigate`), regardless of the answer — the derived Screen union over VaultStatus + SessionStatus is in scope either way.
- If solid-router: does it implement the seam, or does the Screen module still exist with solid-router underneath? Which screens become routes (setup / locked / identities) and which stay internal (identity detail, edit, reveal)?
- If hand-rolled: the thin URL adapter (`history` or `hashchange`) for the same outer screens — is that enough to kill the "back button exits the app" bug?
- Dependency cost, test implications, and the `eslint-vite`/vitest interplay for either choice.
- Record the decision + reasoning as the resolution; a dead rejected option may earn its own ADR so future reviews don't re-suggest it.

## Resolution

**Adopt `@solidjs/router@2.0.0-next.16` now** (human, 2026-08-13), with the toolchain move N1 requires: `solid-js` + `@solidjs/web` → `2.0.0-rc.0`, `vite-plugin-solid` → `3.0.0-next.27` (the only release without peer caps). A fresh `npm install` would land on rc.0 anyway (`^2.0.0-beta.32` now resolves to rc.0).

- The **Screen seam still gets built (N6)** — the router is the **URL adapter behind the seam** for the outer screens only (setup / locked / identities). It is not the enforcement mechanism: guards (locked/booting) live in the derived Screen union, because the 2.0-next router has no declarative guard API.
- **Secrets stay off the URL** — identity detail, derived values, passphrase remain internal state (catch-all route owns them).
- **hash vs history** deferred to N6; N1 verified both work under this deploy (CF SPA fallback + workbox `navigateFallback`, 404-free), with hash as the lower-risk default.
- Accepted costs: ≈ +11 KB gz eager (+12 KB gz precached-lazy), API still moving (no docs, README≠package, open params bug PR #566 — irrelevant since identity detail stays internal). Watch PR #566 before any future cross-route `useParams` use.
- Rejected (noted for future reviews): hand-rolled thin adapter now — revisited only if the router's 2.0 line stalls or the peer churn becomes untenable. Not an ADR-worthy dead end; the seam keeps the router swappable.
