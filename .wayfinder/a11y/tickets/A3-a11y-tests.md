---
id: A3
title: A11y regression tests
type: task
status: closed
blocked_by: [A1, A2]
assigned: agent
---

## Question

No test pins the a11y contract. Add a browser-project test that, for each
flow (setup, locked, identity unlock, settings add-identity, join), asserts:
(1) the field group is a `<form>` and firing `submit` invokes the right
handler; (2) each input is reachable by its accessible label; (3) icon-only
buttons carry an `aria-label`.

## Resolution

`tests/browser/a11y.test.tsx` (6 tests) renders App with call-recording fake
vault/session and pins: setup submits `vault.setup`, locked submits
`vault.unlockWithRecovery`, identity unlock submits `session.unlock`, settings
add-identity commits the vault, join's invitation field is a labelled textarea
inside a form with a `type="submit"` primary, and identity delete buttons are
reachable by `aria-label`. Deep-link tests set the URL before `render` (the
router reacts on mount, not `replaceState` after).
