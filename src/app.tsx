import {
  createContext,
  createEffect,
  createMemo,
  createOptimistic,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js'
import {
  browserHistory,
  createRouter,
  defineRoutes,
  useLocation,
  useNavigate,
} from '@solidjs/router'
import { useVault } from './lib/vault/use-vault.ts'
import type { VaultApi } from './lib/vault/use-vault.ts'
import { useIdentitySession } from './lib/spectre/use-identity-session.ts'
import type { SessionApi } from './lib/spectre/use-identity-session.ts'
import { useInstallPrompt } from './lib/pwa.ts'
import type { BeforeInstallPromptEvent } from './lib/pwa.ts'
import { clearClipboardTimer, useLockLifecycle } from './lib/lifecycle.ts'
import {
  addSite,
  deleteIdentity,
  deleteSite,
  updateSite,
} from './lib/vault/mutations.ts'
import { deriveScreen } from './lib/navigation/screen.ts'
import type { Identity, Site, Vault } from './lib/vault/schema.ts'
import Header from './screens/header.tsx'
import SetupScreen from './screens/setup-screen.tsx'
import LockedScreen from './screens/locked-screen.tsx'
import ErrorScreen from './screens/error-screen.tsx'
import IdentitiesScreen from './screens/identities-screen.tsx'
import IdentityScreen from './screens/identity-screen.tsx'
import JoinScreen from './screens/join-screen.tsx'
import type { SiteFormState } from './screens/site-fields.tsx'
import { getSyncAdapter } from './lib/sync/adapter.ts'
import { shareVaultDoc } from './lib/sync/pairing.ts'
import { syncNow } from './lib/sync/bridge.ts'

const uid = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

interface FlowApi {
  vault: VaultApi
  session: SessionApi
  vaultValue: () => Vault | null
  commitMutation: (next: Vault) => Promise<boolean>
  installPrompt: () => BeforeInstallPromptEvent | null
  onInstall: () => void
}

const FlowContext = createContext<FlowApi>()

function ScreenShell() {
  const api = useContext(FlowContext)!
  const location = useLocation()
  const navigate = useNavigate()

  const derivation = createMemo(() =>
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
  const booting = createMemo(() => {
    const s = screen()
    return s.view === 'booting' ? s : undefined
  })
  const setup = createMemo(() => {
    const s = screen()
    return s.view === 'setup' ? s : undefined
  })
  const locked = createMemo(() => {
    const s = screen()
    return s.view === 'locked' ? s : undefined
  })
  const error = createMemo(() => {
    const s = screen()
    return s.view === 'error' ? s : undefined
  })
  const identitiesCase = createMemo(() => {
    const s = screen()
    return s.view === 'identities' ? s : undefined
  })
  const identityCase = createMemo(() => {
    const s = screen()
    return s.view === 'identity' ? s : undefined
  })
  const joinCase = createMemo(() => {
    const s = screen()
    return s.view === 'join' ? s : undefined
  })
  // The vault-backed render data, wrapped in memos so <Match> never reads a
  // signal directly (Solid 2 rc STRICT_READ_UNTRACKED).
  const identitiesVault = createMemo(() =>
    identitiesCase() ? api.vaultValue() : undefined,
  )
  // Inbound half of the bridge: when the identities screen is reached with a
  // persisted vault doc, re-read known keys into the mirror (experimental).
  createEffect(
    () => identitiesCase(),
    (s) => {
      if (s) void syncNow()
    },
  )
  const identityDetail = createMemo(() => {
    const s = identityCase()
    if (!s) return undefined
    const found = api.vaultValue()?.identities.find((i) => i.id === s.id)
    return found ? { s, found } : undefined
  })

  const onSaveIdentity = async (
    fullName: string,
    passphrase: string,
  ): Promise<void> => {
    const v = api.vaultValue()
    if (!v || !fullName.trim() || passphrase.length < 8) return
    const identity: Identity = {
      id: uid(),
      fullName: fullName.trim(),
      algorithm: 3,
      sites: [],
    }
    const next: Vault = { ...v, identities: [...v.identities, identity] }
    const ok = await api.commitMutation(next)
    if (ok) navigate(`/identity/${identity.id}`)
  }

  const onDeleteIdentity = async (identity: Identity): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    const next: Vault = deleteIdentity(v, identity.id)
    const ok = await api.commitMutation(next)
    if (!ok) return
    api.session.lock()
    const s = screen()
    if (s.view === 'identity' && s.id === identity.id) {
      navigate('/', { replace: true })
    }
  }

  const onAddSite = async (identityId: string, site: Site): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    await api.commitMutation(addSite(v, identityId, site))
  }

  const onUpdateSite = async (
    identityId: string,
    site: Site,
    draft: SiteFormState,
  ): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    const updated: Site = {
      ...site,
      name: draft.name.trim(),
      counter: draft.counter,
      template: draft.template,
      purpose: draft.purpose,
      answer:
        draft.purpose === 'answer' && draft.answer.trim()
          ? draft.answer.trim()
          : undefined,
    }
    await api.commitMutation(updateSite(v, identityId, updated))
  }

  const onDeleteSite = async (
    identityId: string,
    siteId: string,
  ): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    await api.commitMutation(deleteSite(v, identityId, siteId))
  }

  const onUnlockIdentity = (
    identity: Identity,
    passphrase: string,
  ): Promise<boolean> =>
    api.session.unlock(identity, passphrase).then((s) => s !== undefined)

  const onDerive = (site: Site): Promise<string | undefined> =>
    api.session.derive(site)

  const onBack = (): void => {
    api.session.lock()
    navigate('/')
  }

  return (
    <Switch>
      <Match when={booting()} keyed>
        {() => (
          <p data-screen="booting" class="text-sm text-slate-500">
            Opening vault…
          </p>
        )}
      </Match>
      <Match when={setup()} keyed>
        {() => (
          <SetupScreen
            onSubmit={(code) => void api.vault.setup(code)}
            onJoin={() => navigate('/join')}
          />
        )}
      </Match>
      <Match when={locked()} keyed>
        {() => (
          <LockedScreen
            onPasskey={() => void api.vault.unlock()}
            onRecovery={(code) => void api.vault.unlockWithRecovery(code)}
            onJoin={() => navigate('/join')}
          />
        )}
      </Match>
      <Match when={error()} keyed>
        {(s) => (
          <ErrorScreen
            message={s.message}
            onRetry={() => void api.vault.unlock()}
          />
        )}
      </Match>
      <Match when={joinCase()} keyed>
        {() => (
          <JoinScreen
            vaultStatus={api.vault.status}
            onComplete={(joined) => api.vault.importJoined(joined)}
            onBack={() => navigate('/')}
          />
        )}
      </Match>
      <Match when={identitiesVault()} keyed>
        {(v) => (
          <IdentitiesScreen
            vault={v}
            prefs={api.vault.prefs}
            onSelect={(id) => navigate(`/identity/${id}`)}
            onSaveIdentity={(fullName, passphrase) =>
              void onSaveIdentity(fullName, passphrase)
            }
            onDeleteIdentity={(identity) => void onDeleteIdentity(identity)}
            onReEnroll={(code) => api.vault.reEnrollPasskey(code)}
            onSetAutoLock={(minutes) =>
              void api.vault.setAutoLockMinutes(minutes)
            }
            onCreateInvitation={() => shareVaultDoc(getSyncAdapter())}
          />
        )}
      </Match>
      <Match when={identityDetail()} keyed>
        {(detail) => (
          <IdentityScreen
            identity={detail.found}
            sessionStatus={api.session.status}
            sessionIdentityId={api.session.identityId}
            onUnlockIdentity={onUnlockIdentity}
            onBack={onBack}
            onLockSession={api.session.lock}
            onDerive={onDerive}
            onAddSite={(id, site) => void onAddSite(id, site)}
            onUpdateSite={(id, site, draft) =>
              void onUpdateSite(id, site, draft)
            }
            onDeleteSite={(id, siteId) => void onDeleteSite(id, siteId)}
          />
        )}
      </Match>
    </Switch>
  )
}

const Router = createRouter({
  routes: defineRoutes([
    { path: '/', component: ScreenShell },
    { path: '/setup', component: ScreenShell },
    { path: '/locked', component: ScreenShell },
    { path: '/join', component: ScreenShell },
    { path: '/identity/:uuid', component: ScreenShell },
    { path: '/*', component: ScreenShell },
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
