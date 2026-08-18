---
id: GS4
title: Identity picker on host
type: task
status: open
blocked_by: []
assigned:
---

## Question

Let the host **choose which identities** an invitation shares, instead of
sharing every identity.

## Design sketch

- `SettingsScreen` sync card gains a selectable list of the vault's identities
  (checkboxes / multi-select) before "Create invitation".
- Invitation is generated only for the selected set; unselected identities are
  not written to that doc and not synced by that invitation.
- Persist the selection intent alongside the doc (the host pointer already
  carries `identityIds` — keep it scoped to the chosen set).

## Acceptance

- Create-invitation respects the selection; unselected identities never appear
  on the joining side or in the doc.
- Selection is validated (≥1) and defaults sensibly (e.g. all, or a gentle
  first-selection prompt).
