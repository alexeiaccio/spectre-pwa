---
id: R2
title: Kebab-case for all source/test files
type: refactor
status: open
blocked_by: []
assigned:
---

## Question

Rename **every** file in the repo that uses PascalCase (or a mix) to kebab-case — screens, components, hooks, entry points, and tests — matching the repo convention.

## Files to rename (surveyed 2026-08-15)

Screens (`src/screens/`):
- `ErrorScreen.tsx` → `error-screen.tsx`
- `Header.tsx` → `header.tsx`
- `IdentitiesScreen.tsx` → `identities-screen.tsx`
- `IdentityScreen.tsx` → `identity-screen.tsx`
- `JoinScreen.tsx` → `join-screen.tsx`
- `LockedScreen.tsx` → `locked-screen.tsx`
- `SetupScreen.tsx` → `setup-screen.tsx`
- `SiteFields.tsx` → `site-fields.tsx`

UI kit (`src/components/ui/`):
- `Button.tsx` → `button.tsx`
- `Card.tsx` → `card.tsx`
- `Disclosure.tsx` → `disclosure.tsx`
- `Input.tsx` → `input.tsx`
- `NumberField.tsx` → `number-field.tsx`
- `Select.tsx` → `select.tsx`
- `Text.tsx` → `text.tsx`
- `Textarea.tsx` → `textarea.tsx`

Root / hooks / prototypes:
- `src/App.tsx` → `src/app.tsx`
- `src/lib/spectre/useIdentitySession.ts` → `use-identity-session.ts`
- `src/lib/vault/useVault.ts` → `use-vault.ts`
- `src/prototypes/screen-module/AppShell.tsx` → `app-shell.tsx`

Tests: any `tests/**` files with PascalCase/mixed names → kebab-case (survey during the pass; e.g. `re-enroll.test.ts` is already kebab, `screen-navigation.test.tsx` fine — verify).

## Notes

- **Exported symbol names stay PascalCase** (`export default function SetupScreen`) — only file paths change. Import statements update to the new paths.
- `App.tsx` is the Vite entry (`index.html` → `/src/App.tsx`? or `app.tsx`) — check `index.html` script src + `vite.config.ts` entry.
- `SiteFields` exports named constants/type used by callers (`PURPOSE_LABEL`, `TEMPLATES`, `NEW_SITE_DRAFT`, `SiteFormState`) — update import paths.
- `FlowApi`/context and the ui `index.ts` barrel — update all import paths.
- Grep for every `from './...'`, `from '../...'`, `import ... from '...tsx'`, and any test/browser fixtures referencing old paths.
- Prefer `git mv` to preserve history.

## Acceptance

- `find src tests -name "*.ts*" | grep -E "[A-Z]"` returns nothing (all kebab-case).
- `npm run build` + `npm test` (76 tests) green.
