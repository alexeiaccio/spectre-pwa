import { createEffect, createSignal, For, Show } from 'solid-js'
import {
  Button,
  Disclosure,
  Hint,
  Identicon,
  Input,
  Text,
  useIdenticon,
} from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'
import { syncNow } from '../lib/sync/bridge.ts'
import { deleteIdentity } from '../lib/vault/mutations.ts'
import type { Identity } from '../lib/vault/schema.ts'

const uid = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Per-row identicon: derived from the stored passphrase, so it only shows for
 * identities that were unlocked at least once on some device.
 */
function IdentityIcon(props: { identity: Identity }) {
  const icon = useIdenticon(
    () => props.identity.fullName,
    () => props.identity.passphrase ?? '',
  )
  return <Identicon value={icon} />
}

/** `/` — the identity list. Adding happens here in a disclosure; vault
 * settings (re-enroll / auto-lock / sync) live on `/settings`. */
export default function IdentitiesScreen() {
  const { api, view, navigate } = useScreen()
  const [newIdentity, setNewIdentity] = createSignal<{
    fullName: string
    passphrase: string
  }>({ fullName: '', passphrase: '' })
  // 3-step delete (GitHub-style): the id being confirmed + the typed name.
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null)
  const [confirmName, setConfirmName] = createSignal('')

  // Inbound half of the bridge: re-read known keys into the mirror (experimental).
  createEffect(
    () => view('identities')(),
    (s) => {
      if (s) void syncNow()
    },
  )

  const onDeleteIdentity = async (identity: Identity): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    const next = deleteIdentity(v, identity.id)
    const area = await api.commitMutation(next)
    if (area) {
      api.session.lock()
      setConfirmDeleteId(null)
      setConfirmName('')
    }
  }

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

  // Live identicon while the identity (full name + secret) is being typed.
  const identicon = useIdenticon(
    () => newIdentity().fullName,
    () => newIdentity().passphrase,
  )

  const count = (): number => api.vaultValue()?.identities.length ?? 0

  return (
    <div data-screen="identities" class="flex flex-col gap-4">
      <Text>Choose an identity (passphrase is asked when you open it):</Text>
      <div class="flex flex-col gap-2">
        <For each={api.vaultValue()?.identities ?? []}>
          {(identity) => (
            <>
              <div class="flex items-stretch gap-1">
              <button
                class="flex tap flex-1 items-center justify-between rounded border border-surface-700 bg-surface-800 px-3 py-2 text-left text-sm text-slate-100 hover:border-teal-spectre"
                onClick={() => navigate(`/identity/${identity.id}`)}
              >
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <IdentityIcon identity={identity} />
                  <span class="truncate">{identity.fullName}</span>
                </span>
                <span class="ml-2 shrink-0 text-xs text-slate-500">
                  {identity.sites.length} site
                  {identity.sites.length === 1 ? '' : 's'}
                </span>
              </button>
              <button
                class="tap rounded border border-surface-700 bg-surface-800 px-2 text-sm text-slate-500 hover:border-red-900 hover:text-red-400"
                type="button"
                aria-label={`Delete identity ${identity.fullName}`}
                onClick={() => {
                  setConfirmDeleteId(identity.id)
                  setConfirmName('')
                }}
              >
                ✕
              </button>
            </div>
            <Show when={confirmDeleteId() === identity.id}>
              <div class="flex flex-col gap-1 rounded border border-red-900/40 bg-surface-800 p-2">
                <p class="text-xs text-slate-300">
                  Delete “{identity.fullName}”? Type its name to confirm — this
                  can’t be undone.
                </p>
                <Input
                  value={confirmName()}
                  onInput={(e) =>
                    setConfirmName((e.target as HTMLInputElement).value)
                  }
                  placeholder={identity.fullName}
                  aria-label={`Type ${identity.fullName} to confirm deletion`}
                />
                <div class="flex gap-2">
                  <Button
                    variant="primary"
                    type="button"
                    disabled={confirmName() !== identity.fullName}
                    onClick={() => void onDeleteIdentity(identity)}
                  >
                    Delete identity
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      setConfirmDeleteId(null)
                      setConfirmName('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Show>
            </>
          )}
        </For>
      </div>
      <Disclosure label="Add identity" defaultOpen={count() === 0}>
        <Hint>Add an identity (passphrase is your Spectre secret):</Hint>
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void onSaveIdentity()
          }}
        >
          <div class="flex items-center gap-3">
            <Identicon value={identicon} size="lg" />
            <div class="flex flex-1 flex-col gap-2">
              <Input
                label="Full name"
                value={newIdentity().fullName}
                onInput={(e) =>
                  setNewIdentity((n) => ({
                    ...n,
                    fullName: e.currentTarget.value,
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
                    passphrase: e.currentTarget.value,
                  }))
                }
                placeholder="passphrase (min 8)"
                type="password"
                autocomplete="new-password"
                revealable
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
      </Disclosure>
      <button
        class="self-start text-xs text-slate-500 underline hover:text-slate-300"
        onClick={() => navigate('/settings')}
      >
        ⚙ Settings
      </button>
    </div>
  )
}
