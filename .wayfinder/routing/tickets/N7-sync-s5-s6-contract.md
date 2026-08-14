---
id: N7
title: The seam's contract with Sync S5 and S6
type: grilling
status: closed
blocked_by: [N6]
assigned: dev
---

## Question

What must the Screen module **guarantee** so Sync can attach its flows without this effort blocking Sync — and without breaking the ≤2-level depth budget (T6)?

- **Join wizard (S5, device B)**: a multi-step flow — invite entry (QR/string) → sync doc → recovery-code prompt (verified by unwrapping the host's envelope) → re-encrypt under DEK-B → passkey enrollment. Can it be a screen in the union with internal steps, or a nested wizard? Where does the "I have a vault on another device — join it" link (S5) point from needs-setup and locked?
- **Pairing section (S5, device A)**: "Sync with another device" as an identity-picker-level section (per S5:21) — does the seam need a home for it, or does it stay an inline section?
- **Migration state (S6)**: a transient `migrating` case in the union at first unlock after upgrade.
- What the seam must NOT do (no coupling to iroh, envelopes, or DEKs — those stay in Sync's lib layer).
- Deliverable: a contract paragraph for the spec that Sync can consume.

## Resolution

Pinned by grilling with the human (2026-08-14):

- **Join wizard (S5, device B)**: a **`{ view: 'join' }` case in the Screen union**, entry links on the **setup** and **locked** screens. Steps are **internal state** (invite → sync → recovery → enroll), **no per-step URLs** — back from the wizard returns to setup/locked. Sync implements the flow behind the case.
- **Pairing section (S5, device A)**: inline section on the **identities** screen (per S5:21) — **no union case**; it is screen content.
- **Migration (S6)**: a distinct **`{ view: 'migrating' }`** case, transient at first unlock after upgrade (like `booting`).
- **The seam must NOT** import or couple to iroh, envelopes, or DEKs — the union only names views; Sync's flows plug in behind screen components and their callbacks.
- **Contract paragraph for the spec**: "Sync's S5 join flow and pairing section, and S6 migration, consume the seam as screens/views only: `join` (internal steps), `migrating` (transient). No iroh/DEK/envelope knowledge leaks across the seam; Sync ships the flow logic behind screen components."
