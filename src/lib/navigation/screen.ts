import type { SessionStatus } from '../spectre/useIdentitySession.ts'
import type { VaultStatus } from '../vault/useVault.ts'

export type Screen =
  | { view: 'booting' }
  | { view: 'setup' }
  | { view: 'locked' }
  | { view: 'migrating' }
  | { view: 'error'; message: string }
  | { view: 'identities' }
  | { view: 'identity'; id: string; status: SessionStatus }
  | { view: 'join' }

export type RedirectDecision =
  | { kind: 'none' }
  | { kind: 'redirect'; to: string; replace: boolean }

export interface ScreenDerivation {
  screen: Screen
  redirect: RedirectDecision
}

const IDENTITY_RE = /^\/identity\/([^/]+)$/

const noRedirect: RedirectDecision = { kind: 'none' }

const guardTo = (
  screen: Screen,
  target: string,
  pathname: string,
): ScreenDerivation =>
  pathname === target
    ? { screen, redirect: noRedirect }
    : { screen, redirect: { kind: 'redirect', to: target, replace: true } }

export const deriveScreen = (
  vaultStatus: VaultStatus,
  sessionStatus: SessionStatus,
  url: string,
): ScreenDerivation => {
  // /join is reachable from needs-setup and locked (S5 fresh join); unlocked
  // vaults fall through and redirect / (existing-vault re-join is a follow-up).
  // booting and error dominate.
  if (
    url === '/join' &&
    (vaultStatus.kind === 'needs-setup' || vaultStatus.kind === 'locked')
  ) {
    return { screen: { view: 'join' }, redirect: noRedirect }
  }
  switch (vaultStatus.kind) {
    case 'booting':
      return { screen: { view: 'booting' }, redirect: noRedirect }
    case 'needs-setup':
      return guardTo({ view: 'setup' }, '/setup', url)
    case 'needs-migration':
      // Transient, like booting — no URL of its own, never redirected.
      return { screen: { view: 'migrating' }, redirect: noRedirect }
    case 'locked':
      return guardTo({ view: 'locked' }, '/locked', url)
    case 'error':
      return {
        screen: { view: 'error', message: vaultStatus.message },
        redirect: noRedirect,
      }
    case 'unlocked': {
      const match = IDENTITY_RE.exec(url)
      if (match) {
        const exists = vaultStatus.vault.identities.some(
          (i) => i.id === match[1],
        )
        if (!exists) {
          // A uuid that isn't an identity is an unmatched route → redirect /.
          return {
            screen: { view: 'identities' },
            redirect: { kind: 'redirect', to: '/', replace: true },
          }
        }
        return {
          screen: { view: 'identity', id: match[1], status: sessionStatus },
          redirect: noRedirect,
        }
      }
      if (url === '/') {
        return { screen: { view: 'identities' }, redirect: noRedirect }
      }
      return {
        screen: { view: 'identities' },
        redirect: { kind: 'redirect', to: '/', replace: true },
      }
    }
  }
}
