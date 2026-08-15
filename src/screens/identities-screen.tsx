import { createEffect, createSignal, For, Show } from 'solid-js'
import { renderSVG } from 'uqr'
import {
  Button,
  Card,
  Hint,
  Input,
  Select,
  Text,
} from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'
import { getSyncAdapter } from '../lib/sync/adapter.ts'
import { shareVaultDoc } from '../lib/sync/pairing.ts'
import { syncNow } from '../lib/sync/bridge.ts'
import { deleteIdentity } from '../lib/vault/mutations.ts'
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

/** `/` — the identity list. */
export default function IdentitiesScreen() {
  const { api, view, navigate } = useScreen()
  const [newIdentity, setNewIdentity] = createSignal<{
    fullName: string
    passphrase: string
  }>({ fullName: '', passphrase: '' })
  const [reEnrollCode, setReEnrollCode] = createSignal('')
  const [invitation, setInvitation] = createSignal('')
  const [pairing, setPairing] = createSignal(false)
  const [pairError, setPairError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)

  // Inbound half of the bridge: re-read known keys into the mirror (experimental).
  createEffect(
    () => view('identities')(),
    (s) => {
      if (s) void syncNow()
    },
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
    }
    const next = { ...v, identities: [...v.identities, identity] }
    const ok = await api.commitMutation(next)
    if (ok) {
      setNewIdentity({ fullName: '', passphrase: '' })
      navigate(`/identity/${identity.id}`)
    }
  }

  const onDeleteIdentity = async (identity: Identity): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    const next = deleteIdentity(v, identity.id)
    const ok = await api.commitMutation(next)
    if (ok) api.session.lock()
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
    <div data-screen="identities" class="flex flex-col gap-4">
      <Text>Choose an identity (passphrase is asked when you open it):</Text>
      <div class="flex flex-col gap-2">
        <For each={api.vaultValue()?.identities ?? []}>
          {(identity) => (
            <div class="flex items-stretch gap-1">
              <button
                class="flex tap flex-1 items-center justify-between rounded border border-surface-700 bg-surface-800 px-3 py-2 text-left text-sm text-slate-100 hover:border-teal-spectre"
                onClick={() => navigate(`/identity/${identity.id}`)}
              >
                <span class="truncate">{identity.fullName}</span>
                <span class="ml-2 shrink-0 text-xs text-slate-500">
                  {identity.sites.length} site
                  {identity.sites.length === 1 ? '' : 's'}
                </span>
              </button>
              <button
                class="tap rounded border border-surface-700 bg-surface-800 px-2 text-sm text-slate-500 hover:border-red-900 hover:text-red-400"
                title="Delete identity"
                onClick={() => void onDeleteIdentity(identity)}
              >
                ✕
              </button>
            </div>
          )}
        </For>
      </div>
      <Card variant="dashed">
        <Hint>Add an identity (passphrase is your Spectre secret):</Hint>
        <Input
          value={newIdentity().fullName}
          onInput={(e) =>
            setNewIdentity((n) => ({
              ...n,
              fullName: (e.target as HTMLInputElement).value,
            }))
          }
          placeholder="full name"
        />
        <Input
          value={newIdentity().passphrase}
          onInput={(e) =>
            setNewIdentity((n) => ({
              ...n,
              passphrase: (e.target as HTMLInputElement).value,
            }))
          }
          placeholder="passphrase (min 8)"
          type="password"
        />
        <Button
          variant="primary"
          disabled={newIdentity().passphrase.length < 8}
          onClick={() => void onSaveIdentity()}
        >
          Add identity
        </Button>
      </Card>
      <Card variant="dashed">
        <Hint>
          Lost your passkey? Re-enroll a new one (rotates the vault key):
        </Hint>
        <Input
          value={reEnrollCode()}
          onInput={(e) => setReEnrollCode((e.target as HTMLInputElement).value)}
          placeholder="recovery code"
        />
        <Button
          variant="primary"
          disabled={reEnrollCode().length < 8}
          onClick={() => {
            void api.vault.reEnrollPasskey(reEnrollCode()).then((v) => {
              if (v) setReEnrollCode('')
            })
          }}
        >
          Replace passkey
        </Button>
      </Card>
      <Card variant="dashed">
        <Hint>Auto-lock after hiding the app:</Hint>
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
          <div
            class="h-40 w-40 self-center text-surface-950"
            innerHTML={renderSVG(invitation(), { pixelSize: 5, border: 2 })}
          />
          <p class="text-xs break-all text-slate-400">{invitation()}</p>
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
