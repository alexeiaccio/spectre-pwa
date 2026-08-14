import {
  createMemo,
  createOptimistic,
  createSignal,
  onCleanup,
  For,
  Show,
} from 'solid-js'
import { useVault } from './lib/vault/useVault.ts'
import { useIdentitySession } from './lib/spectre/useIdentitySession.ts'
import {
  copyWithAutoClear,
  clearClipboardTimer,
  useLockLifecycle,
} from './lib/lifecycle.ts'
import {
  addSite,
  updateSite,
  deleteSite,
  deleteIdentity,
} from './lib/vault/mutations.ts'
import type { Identity, Site } from './lib/vault/schema.ts'
import type { Vault } from './lib/vault/schema.ts'

const uid = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Chrome/Edge deferred install prompt (not part of the standard TS lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const PURPOSE_LABEL: Record<Site['purpose'], string> = {
  password: 'password',
  login: 'login name',
  answer: 'security answer',
}

const TEMPLATES: Record<string, number> = {
  Long: 17,
  Maximum: 16,
  Medium: 18,
  Short: 19,
  Basic: 20,
  PIN: 21,
  'Login name': 30,
  Phrase: 31,
}

interface SiteFormState {
  name: string
  purpose: Site['purpose']
  template: number
  answer: string
  counter: number
}

const NEW_SITE_DRAFT: SiteFormState = {
  name: '',
  purpose: 'password',
  template: 17,
  answer: '',
  counter: 1,
}

/** Shared name/purpose/template/counter/answer field set for the add-site and edit-site forms. */
function SiteFields(props: {
  draft: SiteFormState
  setDraft: (u: (d: SiteFormState) => SiteFormState) => void
  namePlaceholder: string
}) {
  return (
    <>
      <input
        class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
        value={props.draft.name}
        onInput={(e) =>
          props.setDraft((d) => ({
            ...d,
            name: (e.target as HTMLInputElement).value,
          }))
        }
        placeholder={props.namePlaceholder}
      />
      <div class="flex gap-2">
        <select
          class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={props.draft.purpose}
          onChange={(e) => {
            const purpose = (e.target as HTMLSelectElement)
              .value as Site['purpose']
            const template =
              purpose === 'login' ? 30 : purpose === 'answer' ? 31 : 17
            props.setDraft((d) => ({ ...d, purpose, template }))
          }}
        >
          <option value="password">password</option>
          <option value="login">login name</option>
          <option value="answer">security answer</option>
        </select>
        <select
          class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={props.draft.template}
          onChange={(e) =>
            props.setDraft((d) => ({
              ...d,
              template: Number((e.target as HTMLSelectElement).value),
            }))
          }
        >
          <For each={Object.entries(TEMPLATES)}>
            {([label, id]) => <option value={id}>{label}</option>}
          </For>
        </select>
        <input
          class="tap w-16 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          type="number"
          min={1}
          value={props.draft.counter}
          onInput={(e) =>
            props.setDraft((d) => ({
              ...d,
              counter: Math.max(
                1,
                Number((e.target as HTMLInputElement).value),
              ),
            }))
          }
          placeholder="count"
          title="Spectre counter"
        />
      </div>
      <Show when={props.draft.purpose === 'answer'}>
        <input
          class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={props.draft.answer}
          onInput={(e) =>
            props.setDraft((d) => ({
              ...d,
              answer: (e.target as HTMLInputElement).value,
            }))
          }
          placeholder="security question, e.g. childhood pet"
        />
      </Show>
    </>
  )
}

export default function App() {
  const {
    status,
    busy,
    prefs,
    setAutoLockMinutes,
    setup,
    unlock,
    unlockWithRecovery,
    reEnrollPasskey,
    save,
    lock,
  } = useVault()
  const session = useIdentitySession()
  const [code, setCode] = createSignal('')
  const [reEnrollOpen, setReEnrollOpen] = createSignal(false)
  const [reEnrollCode, setReEnrollCode] = createSignal('')

  // Gate 2 — identity selection state
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [passphrase, setPassphrase] = createSignal('')
  const [recent, setRecent] = createSignal<{
    site: Site
    value: string
  } | null>(null)
  const [copiedId, setCopiedId] = createSignal<string | null>(null)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editDraft, setEditDraft] = createSignal<SiteFormState>({
    ...NEW_SITE_DRAFT,
  })

  // Minimal creation state
  const [newIdentity, setNewIdentity] = createSignal<{
    fullName: string
    passphrase: string
  }>({ fullName: '', passphrase: '' })
  const [newSite, setNewSite] = createSignal<SiteFormState>({
    ...NEW_SITE_DRAFT,
  })

  // PWA install prompt (Chrome/Edge). Fires only when installable and not yet installed.
  const [installPrompt, setInstallPrompt] =
    createSignal<BeforeInstallPromptEvent | null>(null)

  // Optimistic vault layer: mutations update `displayVault` instantly, then
  // reconcile to the persisted `status().vault` after save (revert on failure).
  const [displayVault, setDisplayVault] = createOptimistic<Vault | null>(null)

  const persistedVault = (): Vault | null => {
    const s = status()
    return s.kind === 'unlocked' ? s.vault : null
  }

  /** The vault the UI should show: the optimistic (pending) one if set, else persisted. */
  const vault = (): Vault | null => displayVault() ?? persistedVault()

  /** Commit an optimistic mutation: show it now, persist, reconcile/revert on result. */
  const commitMutation = async (next: Vault): Promise<boolean> => {
    setDisplayVault(next)
    const ok = await save(next)
    // Reconcile: clear the optimistic override. After a successful save the
    // persisted status carries `next`; on failure it still carries the old
    // vault — both are the correct source of truth now.
    setDisplayVault(null)
    return ok
  }

  const onInstall = (): void => {
    const evt = installPrompt()
    if (!evt) return
    void evt.prompt()
    setInstallPrompt(null)
  }

  const onBeforeInstall = (e: Event): void => {
    e.preventDefault()
    setInstallPrompt(e as BeforeInstallPromptEvent)
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('appinstalled', () => setInstallPrompt(null))
  onCleanup(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  })

  const selected = (): Identity | null => {
    const v = vault()
    return v?.identities.find((i) => i.id === selectedId()) ?? null
  }

  const allLock = (): void => {
    session.lock()
    clearClipboardTimer()
    if (copyTimer !== null) {
      clearTimeout(copyTimer)
      copyTimer = null
    }
    setCopiedId(null)
    setRecent(null)
    setSelectedId(null)
    setPassphrase('')
    lock()
  }

  useLockLifecycle(
    allLock,
    () => status().kind === 'unlocked' || session.status().kind === 'ready',
    () => prefs().autoLockMinutes * 60_000,
  )

  const onUnlockIdentity = async (): Promise<void> => {
    const s = status()
    if (s.kind !== 'unlocked') return
    const identity = s.vault.identities.find((i) => i.id === selectedId())
    if (!identity) return
    const done = await session.unlock(identity, passphrase())
    if (done) {
      setPassphrase('')
      setRecent(null)
    }
  }

  const onSaveIdentity = async (): Promise<void> => {
    const v = vault()
    const n = newIdentity()
    if (!v || !n.fullName.trim() || n.passphrase.length < 8) return
    const identity: Identity = {
      id: uid(),
      fullName: n.fullName.trim(),
      algorithm: 3,
      sites: [],
    }
    const next: Vault = {
      ...v,
      identities: [...v.identities, identity],
    }
    const ok = await commitMutation(next)
    if (!ok) return
    setNewIdentity({ fullName: '', passphrase: '' })
    setSelectedId(identity.id)
  }

  const onAddSite = async (): Promise<void> => {
    const v = vault()
    const identity = selected()
    const n = newSite()
    if (!v || !identity || !n.name.trim()) return
    const site: Site = {
      id: uid(),
      name: n.name.trim(),
      counter: n.counter,
      template: n.template,
      purpose: n.purpose,
      answer:
        n.purpose === 'answer' && n.answer.trim() ? n.answer.trim() : undefined,
    }
    const next: Vault = addSite(v, identity.id, site)
    const ok = await commitMutation(next)
    if (!ok) return
    setNewSite({ ...NEW_SITE_DRAFT })
  }

  const onStartEdit = (site: Site): void => {
    setEditingId(site.id)
    setEditDraft({
      name: site.name,
      purpose: site.purpose,
      template: site.template,
      answer: site.answer ?? '',
      counter: site.counter,
    })
  }

  const onCancelEdit = (): void => {
    setEditingId(null)
  }

  const onUpdateSite = async (site: Site): Promise<void> => {
    const v = vault()
    const identity = selected()
    const d = editDraft()
    if (!v || !identity || !d.name.trim()) return
    const updated: Site = {
      ...site,
      name: d.name.trim(),
      counter: d.counter,
      template: d.template,
      purpose: d.purpose,
      answer:
        d.purpose === 'answer' && d.answer.trim() ? d.answer.trim() : undefined,
    }
    const next: Vault = updateSite(v, identity.id, updated)
    const ok = await commitMutation(next)
    if (!ok) return
    setEditingId(null)
    setRecent(null)
    setCopiedId(null)
  }

  const onDeleteSite = async (site: Site): Promise<void> => {
    const v = vault()
    const identity = selected()
    if (!v || !identity) return
    const next: Vault = deleteSite(v, identity.id, site.id)
    const ok = await commitMutation(next)
    if (!ok) return
    setEditingId(null)
    setRecent(null)
    setCopiedId(null)
  }

  const onDeleteIdentity = async (identity: Identity): Promise<void> => {
    const v = vault()
    if (!v) return
    const next: Vault = deleteIdentity(v, identity.id)
    const ok = await commitMutation(next)
    if (!ok) return
    if (selectedId() === identity.id) {
      setSelectedId(null)
      session.lock()
    }
  }

  const onDerive = async (site: Site): Promise<void> => {
    const value = await session.derive(site)
    if (value !== undefined) setRecent({ site, value })
  }

  const onCopy = (siteId: string, value: string): void => {
    copyWithAutoClear(value)
    setCopiedId(siteId)
    if (copyTimer !== null) clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => setCopiedId(null), 1500)
  }

  let copyTimer: number | null = null

  return (
    <div class="flex h-full flex-col">
      <header class="flex items-center justify-between gap-2 border-b border-surface-700 px-4 py-3">
        <h1 class="text-lg font-semibold text-slate-100">Spectre Pocket</h1>
        <div class="flex items-center gap-2">
          <Show when={installPrompt()}>
            <button
              class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white"
              onClick={onInstall}
            >
              Install
            </button>
          </Show>
          <button
            class="rounded border border-surface-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
            onClick={allLock}
          >
            Lock
          </button>
        </div>
      </header>
      <main class="flex flex-1 flex-col gap-4 px-4 py-6">
        <Show when={busy()}>
          <p class="text-sm text-teal-spectre">Working…</p>
        </Show>

        <Show when={status().kind === 'booting'}>
          <p class="text-sm text-slate-500">Opening vault…</p>
        </Show>

        <Show when={status().kind === 'needs-setup'}>
          <div class="flex flex-col gap-4">
            <p class="text-sm text-slate-400">
              First run — create your vault with a passkey. Add a recovery code
              as a second way in:
            </p>
            <input
              class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
              value={code()}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              placeholder="recovery code"
            />
            <button
              class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white"
              onClick={() => void setup(code())}
            >
              Create vault
            </button>
          </div>
        </Show>

        <Show when={status().kind === 'locked'}>
          <div class="flex flex-col gap-4">
            <button
              class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white"
              onClick={() => void unlock()}
            >
              Unlock with passkey
            </button>
            <p class="text-sm text-slate-400">…or with your recovery code:</p>
            <div class="flex flex-col gap-2">
              <input
                class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
                value={code()}
                onInput={(e) => setCode((e.target as HTMLInputElement).value)}
                placeholder="recovery code"
              />
              <button
                class="tap rounded border border-surface-700 px-2 py-1 text-sm text-slate-300"
                onClick={() => void unlockWithRecovery(code())}
              >
                Unlock with code
              </button>
              <button
                class="text-xs text-slate-500 underline hover:text-slate-300"
                onClick={() => setReEnrollOpen((v) => !v)}
              >
                Replace lost passkey…
              </button>
              <Show when={reEnrollOpen()}>
                <p class="text-xs text-slate-500">
                  Unlock first (above), then confirm your recovery code here to
                  enroll a new passkey.
                </p>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={status().kind === 'unlocked'}>
          <Show when={!selected()} fallback={<IdentityView />}>
            <p class="text-sm text-slate-400">
              Choose an identity (passphrase is asked when you open it):
            </p>
            <div class="flex flex-col gap-2">
              <For each={vault()?.identities ?? []}>
                {(identity) => (
                  <div class="flex items-stretch gap-1">
                    <button
                      class="flex tap flex-1 items-center justify-between rounded border border-surface-700 bg-surface-800 px-3 py-2 text-left text-sm text-slate-100 hover:border-teal-spectre"
                      onClick={() => setSelectedId(identity.id)}
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
            <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
              <p class="text-sm text-slate-500">
                Add an identity (passphrase is your Spectre secret):
              </p>
              <input
                class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
                value={newIdentity().fullName}
                onInput={(e) =>
                  setNewIdentity((n) => ({
                    ...n,
                    fullName: (e.target as HTMLInputElement).value,
                  }))
                }
                placeholder="full name"
              />
              <input
                class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
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
              <button
                class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                disabled={newIdentity().passphrase.length < 8}
                onClick={() => void onSaveIdentity()}
              >
                Add identity
              </button>
            </div>
            <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
              <p class="text-sm text-slate-500">
                Lost your passkey? Re-enroll a new one (rotates the vault key):
              </p>
              <input
                class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
                value={reEnrollCode()}
                onInput={(e) =>
                  setReEnrollCode((e.target as HTMLInputElement).value)
                }
                placeholder="recovery code"
              />
              <button
                class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                disabled={reEnrollCode().length < 8}
                onClick={() => {
                  void reEnrollPasskey(reEnrollCode()).then((v) => {
                    if (v) setReEnrollCode('')
                  })
                }}
              >
                Replace passkey
              </button>
            </div>
            <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
              <p class="text-sm text-slate-500">
                Auto-lock after hiding the app:
              </p>
              <select
                class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
                value={prefs().autoLockMinutes}
                onChange={(e) =>
                  void setAutoLockMinutes(
                    Number((e.target as HTMLSelectElement).value),
                  )
                }
              >
                <option value={1}>1 minute</option>
                <option value={2}>2 minutes</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          </Show>
        </Show>

        <Show when={status().kind === 'error'}>
          <p class="text-sm text-red-400">
            {(status() as { message: string }).message}
          </p>
          <button
            class="mt-2 text-sm text-teal-spectre"
            onClick={() => void unlock()}
          >
            Retry unlock
          </button>
        </Show>
      </main>
    </div>
  )

  function IdentityView() {
    const identity = createMemo(() => selected())
    const ses = createMemo(() => session.status())
    const errorMsg = createMemo(() => {
      const s = ses()
      return s.kind === 'error' ? (
        <p class="text-sm text-red-400">{s.message}</p>
      ) : null
    })

    const addSiteBlock = () => (
      <div class="flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3">
        <p class="text-sm text-slate-500">
          Add a site (derives on demand, no stored secrets):
        </p>
        <SiteFields
          draft={newSite()}
          setDraft={setNewSite}
          namePlaceholder="site name, e.g. twitter.com"
        />
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white"
          onClick={() => void onAddSite()}
        >
          Add site
        </button>
      </div>
    )

    return (
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <p class="text-lg font-medium text-slate-100">
            {identity()?.fullName}
          </p>
          <button
            class="text-xs text-slate-500 hover:text-slate-300"
            onClick={() => setSelectedId(null)}
          >
            ← identities
          </button>
        </div>

        <Show
          when={ses().kind === 'idle' || ses().kind === 'error'}
          fallback={null}
        >
          <div class="flex flex-col gap-2">
            {errorMsg()}
            <p class="text-sm text-slate-400">
              This identity is passphrase-locked. The secret is derived once per
              session:
            </p>
            <input
              class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
              value={passphrase()}
              onInput={(e) =>
                setPassphrase((e.target as HTMLInputElement).value)
              }
              placeholder="Spectre passphrase"
              type="password"
            />
            <button
              class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-white"
              onClick={() => void onUnlockIdentity()}
            >
              Unlock identity
            </button>
          </div>
        </Show>

        <Show
          when={ses().kind === 'ready'}
          fallback={
            <Show when={ses().kind === 'working'}>
              <p class="text-sm text-teal-spectre">Deriving…</p>
            </Show>
          }
        >
          <div class="flex flex-col gap-2">
            <p class="text-xs text-slate-500">
              Tap a site to reveal it; tap the value to copy (auto-clears after
              30s).
            </p>
            <For each={identity()?.sites ?? []}>
              {(site) => {
                const revealed = createMemo(() => recent()?.site.id === site.id)
                return (
                  <div class="rounded border border-surface-700 bg-surface-800 hover:border-teal-spectre">
                    <button
                      class="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-100"
                      onClick={() => void onDerive(site)}
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block truncate">{site.name}</span>
                        {site.purpose === 'answer' && site.answer ? (
                          <span class="block truncate text-xs text-slate-500">
                            {site.answer}
                          </span>
                        ) : null}
                      </span>
                      <span class="shrink-0 text-xs text-slate-500">
                        {PURPOSE_LABEL[site.purpose]} · #{site.counter}
                      </span>
                    </button>
                    <Show when={revealed() && recent()}>
                      {(r) => (
                        <button
                          class="flex min-h-11 w-full items-center justify-between gap-2 border-t border-surface-700 px-3 py-2 text-left"
                          onClick={() => onCopy(r().site.id, r().value)}
                        >
                          <span class="font-mono text-sm break-all text-teal-spectre">
                            {r().value}
                          </span>
                          <span class="shrink-0 text-xs text-slate-500">
                            {copiedId() === r().site.id
                              ? 'copied'
                              : 'tap to copy'}
                          </span>
                        </button>
                      )}
                    </Show>
                    <Show when={editingId() === site.id}>
                      <div class="flex flex-col gap-2 border-t border-surface-700 p-3">
                        <SiteFields
                          draft={editDraft()}
                          setDraft={setEditDraft}
                          namePlaceholder="site name"
                        />
                        <div class="flex gap-2">
                          <button
                            class="tap rounded bg-teal-spectre px-3 py-1 text-xs font-medium text-white"
                            onClick={() => void onUpdateSite(site)}
                          >
                            Save
                          </button>
                          <button
                            class="tap rounded border border-surface-700 px-3 py-1 text-xs text-slate-300"
                            onClick={onCancelEdit}
                          >
                            Cancel
                          </button>
                          <button
                            class="ml-auto tap rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:text-red-300"
                            onClick={() => void onDeleteSite(site)}
                          >
                            Delete site
                          </button>
                        </div>
                      </div>
                    </Show>
                    <Show when={editingId() !== site.id}>
                      <button
                        class="block w-full rounded-b border-t border-surface-700 px-3 py-1 text-left text-xs text-slate-500 hover:text-slate-300"
                        onClick={() => onStartEdit(site)}
                      >
                        edit
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
            {addSiteBlock()}
          </div>
        </Show>
      </div>
    )
  }
}
