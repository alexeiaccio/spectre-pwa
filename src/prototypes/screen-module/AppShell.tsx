import {
  Match,
  Switch,
  createContext,
  createEffect,
  createMemo,
  useContext,
} from 'solid-js'
import {
  browserHistory,
  createRouter,
  defineRoutes,
  useLocation,
  useNavigate,
  useParams,
} from '@solidjs/router'
import { deriveScreen } from '../../lib/navigation/screen.ts'
import type { SessionStatus } from '../../lib/spectre/useIdentitySession.ts'
import type { VaultStatus } from '../../lib/vault/useVault.ts'

interface StatusSource {
  vaultStatus: () => VaultStatus
  sessionStatus: () => SessionStatus
}

const StatusSourceContext = createContext<StatusSource>()

function ScreenShell() {
  const status = useContext(StatusSourceContext)
  const location = useLocation()
  const navigate = useNavigate()
  const derivation = createMemo(() =>
    deriveScreen(
      status.vaultStatus(),
      status.sessionStatus(),
      location.pathname,
    ),
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
  const identities = createMemo(() => {
    const s = screen()
    return s.view === 'identities' ? s : undefined
  })
  const identity = createMemo(() => {
    const s = screen()
    return s.view === 'identity' ? s : undefined
  })
  return (
    <Switch>
      <Match when={booting()} keyed>
        {() => <div data-screen="booting">Booting…</div>}
      </Match>
      <Match when={setup()} keyed>
        {() => <div data-screen="setup">Setup</div>}
      </Match>
      <Match when={locked()} keyed>
        {() => <div data-screen="locked">Locked</div>}
      </Match>
      <Match when={error()} keyed>
        {(s) => <div data-screen="error">{s.message}</div>}
      </Match>
      <Match when={identities()} keyed>
        {() => <div data-screen="identities">Identities</div>}
      </Match>
      <Match when={identity()} keyed>
        {(s) => <IdentityStub id={s.id} status={s.status} />}
      </Match>
    </Switch>
  )
}

function IdentityStub(props: { id: string; status: SessionStatus }) {
  const params = useParams()
  return (
    <div data-screen="identity" data-id={props.id}>
      <h2>Identity {props.id}</h2>
      <p>route param: {params.uuid}</p>
      <p>session: {props.status.kind}</p>
    </div>
  )
}

const Router = createRouter({
  routes: defineRoutes([
    { path: '/', component: ScreenShell },
    { path: '/setup', component: ScreenShell },
    { path: '/locked', component: ScreenShell },
    { path: '/identity/:uuid', component: ScreenShell },
    { path: '/*', component: ScreenShell },
  ]),
  history: browserHistory(),
})

export interface AppShellProps {
  vaultStatus: () => VaultStatus
  sessionStatus: () => SessionStatus
}

export function AppShell(props: AppShellProps) {
  return (
    <StatusSourceContext
      value={{
        vaultStatus: props.vaultStatus,
        sessionStatus: props.sessionStatus,
      }}
    >
      <Router>
        {(root) => <main data-prototype="screen-module">{root.children}</main>}
      </Router>
    </StatusSourceContext>
  )
}
