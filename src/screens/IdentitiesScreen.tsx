import { createSignal, For, Show } from 'solid-js'
import {
  Content as SelectContent,
  Item as SelectItem,
  ItemLabel as SelectItemLabel,
  Listbox as SelectListbox,
  Portal as SelectPortal,
  Root as SelectRoot,
  Trigger as SelectTrigger,
  Value as SelectValue,
} from '@kobalte/core/select'
import {
  Input as TextFieldInput,
  Root as TextFieldRoot,
} from '@kobalte/core/text-field'
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
      <p class="text-sm text-slate-400">
        Choose an identity (passphrase is asked when you open it):
      </p>
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
      <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
        <p class="text-sm text-slate-500">
          Add an identity (passphrase is your Spectre secret):
        </p>
        <TextFieldRoot>
          <TextFieldInput
            class="tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            value={newIdentity().fullName}
            onInput={(e) =>
              setNewIdentity((n) => ({
                ...n,
                fullName: (e.target as HTMLInputElement).value,
              }))
            }
            placeholder="full name"
          />
        </TextFieldRoot>
        <TextFieldRoot>
          <TextFieldInput
            class="tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
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
        </TextFieldRoot>
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={newIdentity().passphrase.length < 8}
          onClick={() =>
            props.onSaveIdentity(
              newIdentity().fullName,
              newIdentity().passphrase,
            )
          }
        >
          Add identity
        </button>
      </div>
      <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
        <p class="text-sm text-slate-500">
          Lost your passkey? Re-enroll a new one (rotates the vault key):
        </p>
        <TextFieldRoot>
          <TextFieldInput
            class="tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            value={reEnrollCode()}
            onInput={(e) =>
              setReEnrollCode((e.target as HTMLInputElement).value)
            }
            placeholder="recovery code"
          />
        </TextFieldRoot>
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={reEnrollCode().length < 8}
          onClick={() => {
            void props.onReEnroll(reEnrollCode()).then((v) => {
              if (v) setReEnrollCode('')
            })
          }}
        >
          Replace passkey
        </button>
      </div>
      <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
        <p class="text-sm text-slate-500">Auto-lock after hiding the app:</p>
        <SelectRoot<AutoLockOption>
          options={AUTO_LOCK_OPTIONS}
          optionValue="value"
          optionTextValue="label"
          value={
            AUTO_LOCK_OPTIONS.find(
              (o) => o.value === props.prefs().autoLockMinutes,
            ) ?? AUTO_LOCK_OPTIONS[0]
          }
          onChange={(opt) => {
            if (opt) props.onSetAutoLock(opt.value)
          }}
          itemComponent={(p) => (
            <SelectItem
              item={p.item}
              class="flex tap items-center justify-between gap-2 px-3 py-2 text-sm text-slate-100 data-[highlighted]:bg-surface-700 data-[selected]:text-black"
            >
              <SelectItemLabel>{p.item.rawValue.label}</SelectItemLabel>
            </SelectItem>
          )}
        >
          <SelectTrigger class="flex tap w-full items-center justify-between rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100">
            <SelectValue<AutoLockOption>>
              {(state) => state.selectedOption()?.label ?? '…'}
            </SelectValue>
            <span class="text-xs text-slate-500">▾</span>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent class="z-10 min-w-[12rem] overflow-hidden rounded border border-surface-700 bg-surface-800 p-1 shadow-lg">
              <SelectListbox />
            </SelectContent>
          </SelectPortal>
        </SelectRoot>
      </div>
      <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
        <p class="text-sm text-slate-500">
          Sync with another device (experimental — the other device scans or
          pastes this invitation):
        </p>
        <Show when={!invitation()}>
          <button
            class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
            disabled={pairing()}
            onClick={() => void onCreateInvitation()}
          >
            {pairing() ? 'Creating…' : 'Create invitation'}
          </button>
        </Show>
        <Show when={invitation()}>
          <p class="text-xs break-all text-slate-400">{invitation()}</p>
          <div class="flex items-center gap-2">
            <button
              class="tap rounded border border-surface-700 px-3 py-2 text-xs text-slate-300"
              onClick={onCopyInvitation}
            >
              {copied() ? 'copied' : 'Copy invitation'}
            </button>
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
      </div>
    </div>
  )
}
