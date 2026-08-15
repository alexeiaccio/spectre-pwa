---
id: A2
title: Accessible names for inputs and icon-only buttons
type: task
status: closed
blocked_by: [A1]
assigned: agent
---

## Question

Inputs expose only placeholders (not labelled); icon-only buttons (`✕`, copy,
back) have no accessible name. Add Kobalte `label` + `autocomplete` to
`Input`/`Textarea`, and `aria-label` to icon-only buttons, so every control is
nameable by assistive tech and browsers can offer the right autofill.

## Resolution

`Input` (Kobalte TextField) gained a `label` prop rendered as an associated
`<label>` (text-xs slate-500) plus an `autocomplete` passthrough; `Textarea`
gained a labelled wrapper (`for`/`id` associated). Labels wired on every
field: Recovery code, Full name, Passphrase, Spectre passphrase, Site name,
Security question answer, Invitation string. `autocomplete`: recovery-code /
passphrase fields get `current-password` on unlock flows and `new-password` on
creation flows, `name` on the full-name field. Icon-only buttons now carry
`aria-label`: identity delete (`Delete identity <name>`) and the revealed-value
copy button (`Copy <site> value`).
