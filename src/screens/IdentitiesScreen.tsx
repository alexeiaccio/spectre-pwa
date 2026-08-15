import { createSignal, For, Show } from 'solid-js'
import {
  Button,
  Card,
  Hint,
  Input,
  Select,
  Text,
} from '../components/ui/index.ts'
import type { Identity, Prefs, Vault } from '../lib/vault/schema.ts'

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

export default function IdentitiesScreen(props: {
  vault: Vault
  prefs: () => Prefs
  onSelect: (id: string) => void
  onSaveIdentity: (fullName: string, passphrase: string) => void
  onDeleteIdentity: (identity: Identity) => void
  onReEnroll: (code: string) => Promise<Vault | undefined>
  onSetAutoLock: (minutes: number) => void
  onCreateInvitation: () => Promise<string>
}) {
  const [newIdentity, setNewIdentity] = createSignal<{
    fullName: string
    passphrase: string
  }>({ fullName: '', passphrase: '' })
  const [reEnrollCode, setReEnrollCode] = createSignal('')
  const [invitation, setInvitation] = createSignal('')
  const [pairing, setPairing] = createSignal(false)
  const [pairError, setPairError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)

  const onCreateInvitation = async (): Promise<void> => {
    setPairing(true)
    setPairError(null)
    try {
      const ticket = await props.onCreateInvitation()
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
        <For each={props.vault.identities}>
          {(identity) => (
            <div class="flex items-stretch gap-1">
              <button
                class="flex tap flex-1 items-center justify-between rounded border border-surface-700 bg-surface-800 px-3 py-2 text-left text-sm text-slate-100 hover:border-teal-spectre"
                onClick={() => props.onSelect(identity.id)}
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
                onClick={() => props.onDeleteIdentity(identity)}
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
          onClick={() =>
            props.onSaveIdentity(
              newIdentity().fullName,
              newIdentity().passphrase,
            )
          }
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
            void props.onReEnroll(reEnrollCode()).then((v) => {
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
              (o) => o.value === props.prefs().autoLockMinutes,
            ) ?? AUTO_LOCK_OPTIONS[0]
          }
          onChange={(opt) => props.onSetAutoLock(opt.value)}
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
