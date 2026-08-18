import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { Effect } from 'effect'
import {
  Button,
  Card,
  Hint,
  Input,
  QrCode,
  Select,
} from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'
import { getSyncAdapter, persistDoc } from '../lib/sync/adapter.ts'
import { createGroupInvitation } from '../lib/sync/invitation.ts'
import { readMeta } from '../lib/vault/storage.ts'
import { vaultImpl } from '../lib/vault/service.ts'

interface AutoLockOption {
  value: number
  label: string
}

const AUTO_LOCK_OPTIONS: AutoLockOption[] = [
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
]

/** Stable group id derived from the shared group key K (all devices agree). */
const groupIdOf = async (rawK: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', rawK.slice().buffer)
  const bytes = new Uint8Array(digest).slice(0, 16)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `/settings` — vault settings: re-enroll, auto-lock, sync/pairing. */
export default function SettingsScreen() {
  const { api, navigate } = useScreen()
  const [reEnrollCode, setReEnrollCode] = createSignal('')
  const [invitation, setInvitation] = createSignal('')
  const [pairing, setPairing] = createSignal(false)
  const [pairError, setPairError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)
  const [diag, setDiag] = createSignal<string[]>([])

  // While the invitation is shown, poll spike-style connection diagnostics
  // (relay / node / doc sync) so the host can see its sync state.
  createEffect(
    () => invitation(),
    (inv) => {
      if (!inv) {
        setDiag([])
        return
      }
      const timer = window.setInterval(() => {
        const s = getSyncAdapter()
        void (async () => {
          try {
            const docId = s.docIdFromTicket(inv)
            const lines: string[] = []
            lines.push(`relay: ${await s.relayStatus()}`)
            lines.push(`node: ${await s.nodeId()}`)
            lines.push(`sync: ${await s.syncStatus(docId)}`)
            lines.push(`peers: ${await s.syncPeers(docId)}`)
            setDiag(lines)
          } catch {
            // node not up yet — skip this tick
          }
        })()
      }, 3000)
      onCleanup(() => window.clearInterval(timer))
    },
  )

  const onCreateInvitation = async (): Promise<void> => {
    setPairing(true)
    setPairError(null)
    try {
      const sync = getSyncAdapter()
      const raw = await Effect.runPromise(vaultImpl.exportGroupKey())
      const session = await Effect.runPromise(vaultImpl.session())
      if (!session) throw new Error('vault locked')
      const meta = await Effect.runPromise(readMeta())
      if (!meta?.deviceId) throw new Error('no device identity')
      const groupId = await groupIdOf(new Uint8Array(raw))
      const invitation = await createGroupInvitation({
        sync,
        groupId,
        deviceId: meta.deviceId,
        identities: session.vault.identities,
        groupKeyRaw: new Uint8Array(raw),
        persist: (t, docId) => persistDoc(t, docId),
      })
      setInvitation(invitation)
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String(e))
    } finally {
      setPairing(false)
    }
  }

  const onCopyInvitation = (): void => {
    void navigator.clipboard?.writeText(invitation())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div data-screen="settings" class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <p class="text-lg font-medium text-slate-100">Settings</p>
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          onClick={() => navigate('/')}
        >
          ← identities
        </button>
      </div>
      <Card variant="dashed">
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void api.vault.reEnrollPasskey(reEnrollCode()).then((v) => {
              if (v) setReEnrollCode('')
            })
          }}
        >
          <Hint>
            Lost your passkey? Re-enroll a new one (rotates the vault key):
          </Hint>
          <Input
            label="Recovery code"
            value={reEnrollCode()}
            onInput={(e) =>
              setReEnrollCode((e.target as HTMLInputElement).value)
            }
            placeholder="recovery code"
            autocomplete="current-password"
          />
          <Button
            variant="primary"
            type="submit"
            disabled={reEnrollCode().length < 8}
          >
            Replace passkey
          </Button>
        </form>
      </Card>
      <Card variant="dashed">
        <Hint>Auto-lock after inactivity or hiding the app:</Hint>
        <Select
          options={AUTO_LOCK_OPTIONS}
          value={
            AUTO_LOCK_OPTIONS.find(
              (o) => o.value === api.vault.prefs().autoLockMinutes,
            ) ?? AUTO_LOCK_OPTIONS[0]
          }
          onChange={(opt) => void api.vault.setAutoLockMinutes(opt.value)}
        />
      </Card>
      <Card variant="dashed">
        <Hint>
          Sync with another device (experimental — the other device scans or
          pastes this invitation):
        </Hint>
        <Show when={!invitation()}>
          <Button
            variant="primary"
            disabled={pairing()}
            onClick={() => void onCreateInvitation()}
          >
            {pairing() ? 'Creating…' : 'Create invitation'}
          </Button>
        </Show>
        <Show when={invitation()}>
          <QrCode
            value={invitation()}
            class="h-auto w-full max-w-sm self-center text-surface-950"
          />
          <p class="text-xs break-all text-slate-400">{invitation()}</p>
          <Show when={diag().length}>
            <pre class="rounded border border-surface-700 bg-surface-800 p-2 text-xs text-slate-400">
              {diag().join('\n')}
            </pre>
          </Show>
          <div class="flex items-center gap-2">
            <Button variant="secondary" onClick={onCopyInvitation}>
              {copied() ? 'copied' : 'Copy invitation'}
            </Button>
            <button
              class="text-xs text-slate-500 underline hover:text-slate-300"
              onClick={() => setInvitation('')}
            >
              hide
            </button>
          </div>
        </Show>
        <Show when={pairError()}>
          <p class="text-xs text-red-400">{pairError()}</p>
        </Show>
      </Card>
    </div>
  )
}
