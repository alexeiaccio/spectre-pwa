import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import {
  Button,
  Card,
  Hint,
  Identicon,
  Input,
  QrCode,
  Select,
  useIdenticon,
} from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'
import { getSyncAdapter } from '../lib/sync/adapter.ts'
import { shareVaultDoc } from '../lib/sync/pairing.ts'
import type { Identity } from '../lib/vault/schema.ts'

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

const uid = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** `/settings` — add identity + vault settings (reachable only when unlocked). */
export default function SettingsScreen() {
  const { api, navigate } = useScreen()
  const [newIdentity, setNewIdentity] = createSignal<{
    fullName: string
    passphrase: string
  }>({ fullName: '', passphrase: '' })
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

  // Live identicon while the identity (full name + secret) is being generated.
  const identicon = useIdenticon(
    () => newIdentity().fullName,
    () => newIdentity().passphrase,
  )

  const onSaveIdentity = async (): Promise<void> => {
    const v = api.vaultValue()
    const n = newIdentity()
    if (!v || !n.fullName.trim() || n.passphrase.length < 8) return
    const identity: Identity = {
      id: uid(),
      fullName: n.fullName.trim(),
      algorithm: 3,
      sites: [],
      passphrase: n.passphrase,
    }
    const next = { ...v, identities: [...v.identities, identity] }
    const ok = await api.commitMutation(next)
    if (ok) {
      setNewIdentity({ fullName: '', passphrase: '' })
      navigate(`/identity/${identity.id}`)
    }
  }

  const onCreateInvitation = async (): Promise<void> => {
    setPairing(true)
    setPairError(null)
    try {
      const ticket = await shareVaultDoc(getSyncAdapter())
      setInvitation(ticket)
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
            void onSaveIdentity()
          }}
        >
          <Hint>Add an identity (passphrase is your Spectre secret):</Hint>
          <div class="flex items-center gap-3">
            <Identicon value={identicon} size="lg" />
            <div class="flex flex-1 flex-col gap-2">
              <Input
                label="Full name"
                value={newIdentity().fullName}
                onInput={(e) =>
                  setNewIdentity((n) => ({
                    ...n,
                    fullName: (e.target as HTMLInputElement).value,
                  }))
                }
                placeholder="full name"
                autocomplete="name"
              />
              <Input
                label="Passphrase"
                value={newIdentity().passphrase}
                onInput={(e) =>
                  setNewIdentity((n) => ({
                    ...n,
                    passphrase: (e.target as HTMLInputElement).value,
                  }))
                }
                placeholder="passphrase (min 8)"
                type="password"
                autocomplete="new-password"
              />
            </div>
          </div>
          <Button
            variant="primary"
            type="submit"
            disabled={newIdentity().passphrase.length < 8}
          >
            Add identity
          </Button>
        </form>
      </Card>
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
