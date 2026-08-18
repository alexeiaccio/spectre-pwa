import { createOptimistic, Show } from 'solid-js'
import { browserHistory, createRouter, defineRoutes } from '@solidjs/router'
import { useVault } from './lib/vault/use-vault.ts'
import type { VaultApi } from './lib/vault/use-vault.ts'
import { useIdentitySession } from './lib/spectre/use-identity-session.ts'
import type { SessionApi } from './lib/spectre/use-identity-session.ts'
import { useInstallPrompt } from './lib/pwa.ts'
import { clearClipboardTimer, useLockLifecycle } from './lib/lifecycle.ts'
import { useSyncRunner } from './lib/sync/sync-runner.ts'
import { FlowContext } from './lib/flow.ts'
import type { FlowApi } from './lib/flow.ts'
import type { UpdateApi } from './lib/update.ts'
import Header from './screens/header.tsx'
import ErrorScreen from './screens/error-screen.tsx'
import SetupScreen from './screens/setup-screen.tsx'
import LockedScreen from './screens/locked-screen.tsx'
import JoinScreen from './screens/join-screen.tsx'
import IdentitiesScreen from './screens/identities-screen.tsx'
import SettingsScreen from './screens/settings-screen.tsx'
import IdentityScreen from './screens/identity-screen.tsx'
import type { Vault } from './lib/vault/schema.ts'

const Router = createRouter({
  routes: defineRoutes([
    { path: '/', component: IdentitiesScreen },
    { path: '/setup', component: SetupScreen },
    { path: '/locked', component: LockedScreen },
    { path: '/join', component: JoinScreen },
    { path: '/settings', component: SettingsScreen },
    { path: '/identity/:uuid', component: IdentityScreen },
    { path: '/*', component: ErrorScreen },
  ]),
  history: browserHistory(),
})

export interface AppProps {
  vault?: VaultApi
  session?: SessionApi
  update?: UpdateApi
}

export default function App(props: AppProps = {}) {
  const vault = props.vault ?? useVault()
  const session = props.session ?? useIdentitySession()
  const update = props.update ?? {
    updateAvailable: () => false,
    applyUpdate: () => {},
  }
  const { installPrompt, onInstall } = useInstallPrompt()

  const persistedVault = (): Vault | null => {
    const s = vault.status()
    return s.kind === 'unlocked' ? s.vault : null
  }

  // Optimistic vault layer: mutations update `displayVault` instantly, then
  // reconcile to the persisted `status().vault` after save (revert on failure).
  const [displayVault, setDisplayVault] = createOptimistic<Vault | null>(null)
  const vaultValue = (): Vault | null => displayVault() ?? persistedVault()
  const commitMutation = async (next: Vault): Promise<boolean> => {
    setDisplayVault(next)
    const ok = await vault.save(next)
    setDisplayVault(null)
    return ok
  }

  const allLock = (): void => {
    session.lock()
    clearClipboardTimer()
    vault.lock()
  }

  useLockLifecycle(
    allLock,
    () =>
      vault.status().kind === 'unlocked' || session.status().kind === 'ready',
    () => vault.prefs().autoLockMinutes * 60_000,
  )

  // GS5: periodic cross-device sync — app open, in-app timer, foreground and
  // online triggers (skips while locked / before a doc is joined).
  useSyncRunner()

  const api: FlowApi = {
    vault,
    session,
    vaultValue,
    commitMutation,
    installPrompt,
    onInstall,
  }

  return (
    <div class="flex h-full flex-col">
      <Header
        installPrompt={installPrompt}
        onInstall={onInstall}
        onLock={allLock}
        updateAvailable={update.updateAvailable}
        onUpdate={update.applyUpdate}
      />
      <main class="flex flex-1 flex-col gap-4 px-4 py-6">
        <Show when={vault.busy()}>
          <p class="text-sm text-teal-spectre">Working…</p>
        </Show>
        <FlowContext value={api}>
          <Router>{(root) => root.children}</Router>
        </FlowContext>
      </main>
    </div>
  )
}
