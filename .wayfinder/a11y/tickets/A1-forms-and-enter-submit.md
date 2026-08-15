---
id: A1
title: Native form semantics + Enter-to-submit
type: task
status: closed
blocked_by: []
assigned: agent
---

## Question

Pressing Enter in a focused input does nothing (the flows are bare Kobalte
TextFields with no `<form>`). Wrap each input+primary-action group in a native
`<form>` with `onSubmit` (preventDefault → run the handler) and make the
primary button `type="submit"`, so Enter submits and screen readers see a real
form. `Button` gains a `type?: 'submit' | 'button'` prop (default `button` to
preserve today's behavior).

## Resolution

Every flow in the form inventory now wraps its input group in a `<form>` whose
primary button is `type="submit"`: setup (Create vault with passkey), locked
(Unlock with code), identity unlock, add-site + edit-site (Save), settings
add-identity + re-enroll, and the join unlock/invite/recovery steps. The
`Button` component gained the `type` prop (`button` default — unchanged
behavior for non-form buttons). Verified live: pressing Enter in the locked
screen's recovery-code field unlocks the vault. Secondary buttons (e.g.
"Create vault without a passkey", Cancel, Delete) stay `type="button"`.
