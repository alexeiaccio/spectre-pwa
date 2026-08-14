# Wayfinder tracker (local markdown)

This repo uses the **local-markdown** issue tracker (no external tracker configured).

## Efforts

Each effort gets its own self-contained directory under `.wayfinder/` (map + `tickets/` + `research/` + `prototypes/`). The v1 effort lives at the root (`.wayfinder/map.md`); later efforts live in their own dirs.

- **v1 — Spectre Pocket**: `.wayfinder/map.md` (delivered).
- **Sync — Spectre Pocket Sync**: `.wayfinder/sync/map.md` (in progress).
- **Routing — navigation seam + DX tooling**: `.wayfinder/routing/map.md` (charting).
- **Kobalte — form components adoption**: `.wayfinder/kobalte/map.md` (in progress).

## Where things live

- **The map**: `.wayfinder/<effort>/map.md` (or `.wayfinder/map.md` for v1) — single source of the effort's destination + index of decisions.
- **Tickets**: `.wayfinder/<effort>/tickets/NNN-slug.md` — one file per decision ticket, child of the map.

## Ticket file shape

```markdown
---
id: T<NN>
title: <name>
type: research | prototype | grilling | task
status: open | in_progress | closed | out_of_scope
blocked_by: [T<n>]
assigned: <who>
---

## Question
<the decision or investigation this ticket resolves>
```

## Ops

- **Claim**: set `assigned` in the ticket file *before* starting work.
- **Resolve**: append a `## Resolution` section, set `status: closed`, then append one line to the map's *Decisions so far* pointing at the ticket by name+link.
- **Blocking**: open tickets list blocked ids in frontmatter; an unblocked+open ticket is on the frontier.
- **Frontier query**: open tickets whose `blocked_by` are all closed.