import {
  createOptimistic,
  Show,
} from 'solid-js'
import {
  browserHistory,
  createRouter,
  defineRoutes,
} from '@solidjs/router'
import { useVault } from './lib/vault/use-vault.ts'
import type { VaultApi } from './lib/vault/use-vault.ts'
import { useIdentitySession } from './lib/spectre/use-identity-session.ts'
import type { SessionApi } from './lib/spectre/use-identity-session.ts'
import { useInstallPrompt } from './lib/pwa.ts'
import { clearClipboardTimer, useLockLifecycle } from './lib/lifecycle.ts'
import { FlowContext } from './routes/use-screen.ts'
import type { FlowApi } from './routes/use-screen.ts'
import Header from './screens/header.tsx'
import CatchAllRoute from './routes/catch-all-route.tsx'
import SetupRoute from './routes/setup-route.tsx'
import LockedRoute from './routes/locked-route.tsx'
import JoinRoute from './routes/join-route.tsx'
import IdentitiesRoute from './routes/identities-route.tsx'
import IdentityRoute from './routes/identity-route.tsx'
import type { Vault } from './lib/vault/schema.ts'

const Router = createRouter({
  routes: defineRoutes([
    { path: '/', component: IdentitiesRoute },
    { path: '/setup', component: SetupRoute },
    { path: '/locked', component: LockedRoute },
    { path: '/join', component: JoinRoute },
    { path: '/identity/:uuid', component: IdentityRoute },
    { path: '/*', component: CatchAllRoute },
  ]),
  history: browserHistory(),
})

export interface AppProps {
  vault?: VaultApi
  session?: SessionApi
}

export default function App(props: AppProps = {}) {
  const vault = props.vault ?? useVault()
  const session = props.session ?? useIdentitySession()
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
