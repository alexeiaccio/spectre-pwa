---
id: R2
title: Kebab-case screen filenames
type: refactor
status: open
blocked_by: [R1]
assigned:
---

## Question

Rename screen files to kebab-case to match the repo convention, while the per-route refactor (R1) touches their imports anyway.

## Current files

`src/screens/`: `Header.tsx`, `SetupScreen.tsx`, `LockedScreen.tsx`, `ErrorScreen.tsx`, `IdentitiesScreen.tsx`, `IdentityScreen.tsx`, `JoinScreen.tsx`, `SiteFields.tsx`, plus `src/components/ui/*` (already lowercase).

## Target names

- `Header.tsx` → `header.tsx`
- `SetupScreen.tsx` → `setup-screen.tsx`
- `LockedScreen.tsx` → `locked-screen.tsx`
- `ErrorScreen.tsx` → `error-screen.tsx`
- `IdentitiesScreen.tsx` → `identities-screen.tsx`
- `IdentityScreen.tsx` → `identity-screen.tsx`
- `JoinScreen.tsx` → `join-screen.tsx`
- `SiteFields.tsx` → `site-fields.tsx`

## Notes

- Exported component names stay PascalCase (`export default function SetupScreen`) — only the **file** name changes.
- `SiteFields` exports named constants (`PURPOSE_LABEL`, `TEMPLATES`, `NEW_SITE_DRAFT`, `SiteFormState`) used by `IdentityScreen`/`IdentityScreen`'s callers — update those import paths.
- Grep for any test files referencing `screens/*.tsx` and update.
- Prefer `git mv` so history is preserved.

## Acceptance

- All screen files kebab-case; imports updated; `npm run build` + tests green.
