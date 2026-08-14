---
id: N6
title: Shape of the Screen module (derived union, URL boundary, test surface)
type: grilling
status: closed
blocked_by: [N4, N2]
assigned: dev
---

## Question

The core deepening (architecture review C1+C3). Using N4's router decision and N2's harness facts, pin the Screen module's shape:

- **The derived Screen union** — a pure function of VaultStatus + SessionStatus + selection (candidate sketch in the review: `booting / setup / locked / error / identities / identity{status} / join{step}`). Is the pure derivation the whole implementation, or does it need a mutation side (lock reset as a transition)?
- **Secrets-off-URL boundary** — exactly which screens are URL-backed (setup / locked / identities) and which stay internal (identity detail, edit, reveal, join steps). No secret ever in the URL, history, or share state.
- **Lock-grace interplay** — how `useLockLifecycle` feeds the union; returning to a deep link while locked → boot → locked.
- **Back button / deep links** — which URL mode (history vs hash) the router/adapter uses, per N4 + N1.
- **Test surface** — what N9's vitest browser mode tests: pure derivation transitions, screen components, or both. The 9 gates, 7 guard copies, and the unsafe cast at `App.tsx:333` must be gone in the target shape.
- Deliverable: the spec text for the hand-off. Prototype N8 raises fidelity alongside.

## Resolution

Pinned by grilling with the human (2026-08-14). **History mode** (not hash) + **uuid route** for identity detail.

- **Routes (history mode)**: `/setup`, `/locked`, `/` (identities), `/identity/:uuid`. Vault error = screen, **not a route**. Unmatched route → redirect `/`.
- **Screen union** — pure derivation over (VaultStatus, SessionStatus, URL):
  ```ts
  type Screen =
    | { view: 'booting' }
    | { view: 'setup' }
    | { view: 'locked' }
    | { view: 'error'; message: string }
    | { view: 'identities' }
    | { view: 'identity'; id: string; status: SessionStatus }
  ```
- **Guard/redirect rules** (app-state; the union enforces, the router only renders): boot reads the URL → needs-setup→`/setup`, locked→`/locked`, unlocked→`/` or `/identity/:uuid` per URL, vault error→error screen. Deep link while locked → land on `/locked` (replace), never the deep link. Back from `/identity/:uuid` → `/`.
- **Secrets-off-URL**: URL holds only the uuid (`/identity/:uuid`) — no full names, no derived values, no passphrase. `editingId` / `recent` / `copiedId` / `installPrompt` stay **local screen state**, not in the union. This is the honest collapse: 9 gates + `selectedId` absorbed into the union; sub-UI signals stay put.
- **Test surface**: (1) *unit* — table test over the pure Screen derivation (every status × URL → expected Screen, incl. guard/redirect/lock cases); (2) *browser* — `@solidjs/testing-library` renders `App`: each screen, back-button navigation, deep-link→locked redirect.
- **Deliverable**: the hand-off spec, written with N7's contract and N8's prototype validation. Spec lives at `.wayfinder/routing/spec-screen-module.md`.
