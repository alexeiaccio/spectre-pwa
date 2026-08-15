import { createContext, createEffect, createMemo, useContext } from 'solid-js'
import { useLocation, useNavigate } from '@solidjs/router'
import { deriveScreen } from '../lib/navigation/screen.ts'
import type { Screen, ScreenDerivation } from '../lib/navigation/screen.ts'
import type { BeforeInstallPromptEvent } from '../lib/pwa.ts'
import type { SessionApi } from '../lib/spectre/use-identity-session.ts'
import type { VaultApi } from '../lib/vault/use-vault.ts'
import type { Vault } from '../lib/vault/schema.ts'

/** The API each route component consumes (provided above the router in App). */
export interface FlowApi {
  vault: VaultApi
  session: SessionApi
  vaultValue: () => Vault | null
  commitMutation: (next: Vault) => Promise<boolean>
  installPrompt: () => BeforeInstallPromptEvent | null
  onInstall: () => void
}

export const FlowContext = createContext<FlowApi>()

/** Hook: derive the screen for the current URL, apply redirects, return the screen. */
export function useScreen(): {
  api: FlowApi
  screen: () => Screen
  isA: (v: Screen['view']) => () => boolean
  view: <V extends Screen['view']>(
    v: V,
  ) => () => Extract<Screen, { view: V }> | undefined
  navigate: (to: string, opts?: { replace?: boolean }) => void
} {
  const api = useContext(FlowContext)!
  const location = useLocation()
  const navigate = useNavigate()

  const derivation = createMemo<ScreenDerivation>(() =>
    deriveScreen(api.vault.status(), api.session.status(), location.pathname),
  )
  createEffect(
    () => derivation().redirect,
    (redirect) => {
      if (redirect.kind === 'redirect') {
        navigate(redirect.to, { replace: redirect.replace })
      }
    },
  )
  const screen = createMemo(() => derivation().screen)
  /** Boolean accessor variant for `Show when`: `when={isA('booting')()}`. */
  const isA = (v: Screen['view']): (() => boolean) => () => screen().view === v
  /**
   * Reactive accessor for a screen view: returns the matched screen object or
   * undefined. Use as `when={view('identity')()}` in a `keyed` `Show`.
   */
  const view = <V extends Screen['view']>(
    v: V,
  ): (() => Extract<Screen, { view: V }> | undefined) => () => {
    const s = screen()
    return s.view === v ? (s as Extract<Screen, { view: V }>) : undefined
  }
  return { api, screen, isA, view, navigate }
}
