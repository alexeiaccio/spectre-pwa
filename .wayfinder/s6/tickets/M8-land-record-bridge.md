---
id: M8
title: Land the record bridge
type: task
status: open
blocked_by: [M5, M6]
assigned:
---

## Question

Implement the record bridge + incoming merge per M5, on top of M7's v3 mirror and M6's node mirror:

- Outbound push on local edits (per-identity records under this device's DEK, write-on-change, fresh IVs; deletes per S2).
- Inbound merge into the mirror (LWW by v1 uuid, re-encrypt on change only).
- Wire to the sync adapter (`src/lib/sync/`) + the pairing/join flows; all behind the experimental flag with the banner.
- Tests: unit tests for bridge push/merge decisions; browser test for an edit → pushed record → mirrored back round-trip where the flag allows.
- Resolved when green. Record decisions + remaining gaps (e.g. live delivery reliability per M2) in the resolution.
