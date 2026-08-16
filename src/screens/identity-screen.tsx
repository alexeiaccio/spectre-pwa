import {
  createEffect,
  createMemo,
  createOptimistic,
  createSignal,
  onCleanup,
  For,
  Show,
} from 'solid-js'
import Fuse from 'fuse.js'
import {
  Accent,
  Button,
  Card,
  Hint,
  Identicon,
  Input,
  Text,
  useIdenticon,
} from '../components/ui/index.ts'
import { PURPOSE_LABEL, NEW_SITE_DRAFT, SiteFields } from './site-fields.tsx'
import type { SiteFormState } from './site-fields.tsx'
import { copyWithAutoClear } from '../lib/lifecycle.ts'
import { useScreen } from '../lib/flow.ts'
import {
  addSite,
  deleteSite,
  setIdentityPassphrase,
  updateSite,
} from '../lib/vault/mutations.ts'
import type { Site } from '../lib/vault/schema.ts'
import type { SessionStatus } from '../lib/spectre/use-identity-session.ts'

const uid = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** `/identity/:uuid` — one identity's sites. */
export default function IdentityScreen() {
  const { api, view, navigate } = useScreen()
  const detail = createMemo(() => {
    const s = view('identity')()
    if (!s) return undefined
    const found = api.vaultValue()?.identities.find((i) => i.id === s.id)
    return found ? { s, identity: found } : undefined
  })
  const identity = createMemo(() => detail()?.identity)
  const sessionStatus = createMemo(() => api.session.status())
  const sessionIdentityId = createMemo(() => api.session.identityId())
  const onBack = (): void => {
    api.session.lock()
    navigate('/')
  }
  const [passphrase, setPassphrase] = createSignal('')
  const [recent, setRecent] = createSignal<{
    site: Site
    value: string
  } | null>(null)
  const [copiedId, setCopiedId] = createSignal<string | null>(null)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  // Optimistic per-row "Deriving…" indicator: set on tap, reconciled to the
  // revealed value on success, reverted (cleared) on failure.
  const [derivingId, setDerivingId] = createOptimistic<string | null>(null)
  const [editDraft, setEditDraft] = createSignal<SiteFormState>({
    ...NEW_SITE_DRAFT,
  })
  const [newSite, setNewSite] = createSignal<SiteFormState>({
    ...NEW_SITE_DRAFT,
  })
  // Site search (fuzzy) + the empty-state add toggle.
  const [query, setQuery] = createSignal('')
  const [addOpen, setAddOpen] = createSignal(false)

  const allSites = createMemo(() => identity()?.sites ?? [])
  const fuse = createMemo(
    () =>
      new Fuse(allSites(), {
        keys: ['name'],
        threshold: 0.4,
        ignoreLocation: true,
      }),
  )
  const filteredSites = createMemo(() => {
    const q = query().trim()
    if (!q) return allSites()
    return fuse()
      .search(q)
      .map((r) => r.item)
  })

  let copyTimer: number | null = null
  onCleanup(() => {
    if (copyTimer !== null) clearTimeout(copyTimer)
  })

  // Live identicon while the passphrase (Spectre secret) is being typed.
  const identicon = useIdenticon(
    () => identity()?.fullName ?? '',
    () => passphrase(),
  )

  // A ready session unlocked for a different identity must not serve this
  // identity's sites — treat it as idle and lock the stale session.
  const effective = createMemo((): SessionStatus => {
    const s = sessionStatus()
    if (s.kind === 'ready' && sessionIdentityId() !== identity()?.id) {
      return { kind: 'idle' }
    }
    return s
  })
  createEffect(
    () => {
      const s = sessionStatus()
      return s.kind === 'ready' && sessionIdentityId() !== identity()?.id
    },
    // Locking the stale session reads its own signals past the callback
    // boundary — the structural rule can't see the createEffect context.
    // eslint-disable-next-line solid/reactivity
    (mismatch) => {
      if (mismatch) api.session.lock()
    },
  )

  const errorMsg = createMemo(() => {
    const s = effective()
    return s.kind === 'error' ? (
      <p class="text-sm text-red-400">{s.message}</p>
    ) : null
  })
  // Auto-unlock from the stored (DEK-wrapped) passphrase — no re-typing.
  // Fires only when the session is idle for this identity and a passphrase
  // was recorded; unlock transitions to working/ready so this re-runs to a
  // no-op (and an error stops it too).
  createEffect(
    () => {
      const id = identity()
      const s = effective()
      return id?.passphrase && s.kind === 'idle'
        ? { id, passphrase: id.passphrase }
        : null
    },
    (target) => {
      if (target) void api.session.unlock(target.id, target.passphrase)
    },
  )

  // Live "future password" preview while filling the add-site form: derive
  // from the draft on every change (HMAC is cheap). A seq token drops stale
  // async results when the draft changes mid-derive.
  const [previewValue, setPreviewValue] = createSignal<string | null>(null)
  let previewSeq = 0
  createEffect(
    () => {
      const n = newSite()
      const ready = effective().kind === 'ready'
      return ready && n.name.trim() ? { ...n, name: n.name.trim() } : null
    },
    (draft) => {
      if (!draft) {
        setPreviewValue(null)
        return
      }
      const id = ++previewSeq
      const site: Site = {
        id: 'preview',
        name: draft.name,
        counter: draft.counter,
        template: draft.template,
        purpose: draft.purpose,
        answer:
          draft.purpose === 'answer' && draft.answer.trim()
            ? draft.answer.trim()
            : undefined,
      }
      void api.session.derive(site).then((v) => {
        if (id === previewSeq) setPreviewValue(v ?? null)
      })
    },
  )
  const onUnlockIdentity = async (): Promise<void> => {
    const id = identity()
    const entered = passphrase()
    if (!id || !entered) return
    const done = await api.session.unlock(id, entered)
    if (done) {
      setPassphrase('')
      setRecent(null)
      // Record the passphrase under the DEK so future visits auto-unlock.
      if (!id.passphrase) {
        const v = api.vaultValue()
        if (v)
          await api.commitMutation(setIdentityPassphrase(v, id.id, entered))
      }
    }
  }

  const onAddSite = async (): Promise<void> => {
    const id = identity()
    const n = newSite()
    if (!id || !n.name.trim()) return
    const site: Site = {
      id: uid(),
      name: n.name.trim(),
      counter: n.counter,
      template: n.template,
      purpose: n.purpose,
      answer:
        n.purpose === 'answer' && n.answer.trim() ? n.answer.trim() : undefined,
    }
    const v = api.vaultValue()
    if (!v) return
    await api.commitMutation(addSite(v, id.id, site))
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
    const id = identity()
    const d = editDraft()
    if (!id || !d.name.trim()) return
    const v = api.vaultValue()
    if (!v) return
    const updated: Site = {
      ...site,
      name: d.name.trim(),
      counter: d.counter,
      template: d.template,
      purpose: d.purpose,
      answer:
        d.purpose === 'answer' && d.answer.trim() ? d.answer.trim() : undefined,
    }
    await api.commitMutation(updateSite(v, id.id, updated))
    setEditingId(null)
    setRecent(null)
    setCopiedId(null)
  }

  const onDeleteSite = async (site: Site): Promise<void> => {
    const id = identity()
    const v = api.vaultValue()
    if (!id || !v) return
    await api.commitMutation(deleteSite(v, id.id, site.id))
    setEditingId(null)
    setRecent(null)
    setCopiedId(null)
  }

  const onDerive = async (site: Site): Promise<void> => {
    setDerivingId(site.id) // optimistic pending — row shows "Deriving…"
    const value = await api.session.derive(site)
    setDerivingId(null) // reconcile: value is in `recent` on success, absent on failure
    if (value !== undefined) setRecent({ site, value })
  }

  const onCopy = (siteId: string, value: string): void => {
    copyWithAutoClear(value)
    setCopiedId(siteId)
    if (copyTimer !== null) clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => setCopiedId(null), 1500)
  }

  const addSiteBlock = () => (
    <Card variant="dashed">
      <form
        class="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void onAddSite()
        }}
      >
        <Hint>Add a site (derives on demand, no stored secrets):</Hint>
        <SiteFields
          draft={newSite()}
          setDraft={setNewSite}
          namePlaceholder="site name, e.g. twitter.com"
          collapsible
        />
        <Show when={previewValue()}>
          <div class="flex items-center justify-between gap-2 rounded border border-surface-700 bg-surface-800 px-3 py-2">
            <span class="font-mono text-sm break-all text-teal-spectre">
              {previewValue()}
            </span>
            <span class="shrink-0 text-xs text-slate-500">preview</span>
          </div>
        </Show>
        <Button variant="primary" type="submit">
          Add site
        </Button>
      </form>
    </Card>
  )

  return (
    <div
      data-screen="identity"
      data-id={identity()?.id}
      class="flex flex-col gap-4"
    >
      <div class="flex items-center justify-between">
        <p class="text-lg font-medium text-slate-100">{identity()?.fullName}</p>
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          onClick={onBack}
        >
          ← identities
        </button>
      </div>

      <Show
        when={effective().kind === 'idle' || effective().kind === 'error'}
        fallback={null}
      >
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void onUnlockIdentity()
          }}
        >
          {errorMsg()}
          <Text>
            This identity is passphrase-locked. The secret is derived once per
            session:
          </Text>
          <div class="flex items-center gap-3">
            <Identicon value={identicon} size="lg" />
            <Input
              class="flex-1"
              label="Spectre passphrase"
              value={passphrase()}
              onInput={(e) =>
                setPassphrase((e.target as HTMLInputElement).value)
              }
              placeholder="Spectre passphrase"
              type="password"
              autocomplete="current-password"
            />
          </div>
          <Button variant="primary" type="submit">
            Unlock identity
          </Button>
        </form>
      </Show>

      <Show
        when={effective().kind === 'ready'}
        fallback={
          <Show when={effective().kind === 'working'}>
            <Accent>Deriving…</Accent>
          </Show>
        }
      >
        <div class="flex flex-col gap-2">
          <Show when={allSites().length > 0}>
            <Input
              value={query()}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder="search sites"
              title="Search sites"
              class="mb-1"
            />
          </Show>
          <Show when={allSites().length === 0 && !addOpen()}>
            <button
              class="flex tap flex-col items-center gap-1 rounded border border-dashed border-surface-700 px-3 py-8 text-slate-500 hover:border-teal-spectre hover:text-slate-300"
              type="button"
              onClick={() => setAddOpen(true)}
            >
              <span class="text-3xl leading-none">＋</span>
              <span class="text-sm">Add a site</span>
            </button>
          </Show>
          <Show when={allSites().length > 0}>
            <Hint>
              Tap a site to reveal it; tap the value to copy (auto-clears after
              30s).
            </Hint>
            <For each={filteredSites()}>
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
                        {derivingId() === site.id
                          ? 'Deriving…'
                          : `${PURPOSE_LABEL[site.purpose]} · #${site.counter}`}
                      </span>
                    </button>
                    <Show when={revealed() && recent()}>
                      {(r) => (
                        <button
                          class="flex min-h-11 w-full items-center justify-between gap-2 border-t border-surface-700 px-3 py-2 text-left"
                          aria-label={`Copy ${site.name} value`}
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
                      <form
                        class="flex flex-col gap-2 border-t border-surface-700 p-3"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void onUpdateSite(site)
                        }}
                      >
                        <SiteFields
                          draft={editDraft()}
                          setDraft={setEditDraft}
                          namePlaceholder="site name"
                        />
                        <div class="flex gap-2">
                          <Button variant="primary" type="submit">
                            Save
                          </Button>
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={onCancelEdit}
                          >
                            Cancel
                          </Button>
                          <button
                            class="ml-auto tap rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:text-red-300"
                            type="button"
                            onClick={() => void onDeleteSite(site)}
                          >
                            Delete site
                          </button>
                        </div>
                      </form>
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
            <Show when={query().trim() && filteredSites().length === 0}>
              <Hint>No sites match “{query().trim()}”.</Hint>
            </Show>
          </Show>
          <Show when={allSites().length === 0 ? addOpen() : true}>
            {addSiteBlock()}
          </Show>
        </div>
      </Show>
    </div>
  )
}
