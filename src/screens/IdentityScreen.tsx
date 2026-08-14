import {
  createEffect,
  createMemo,
  createOptimistic,
  createSignal,
  onCleanup,
  For,
  Show,
} from 'solid-js'
import { PURPOSE_LABEL, NEW_SITE_DRAFT, SiteFields } from './SiteFields.tsx'
import type { SiteFormState } from './SiteFields.tsx'
import { copyWithAutoClear } from '../lib/lifecycle.ts'
import type { Identity, Site } from '../lib/vault/schema.ts'
import type { SessionStatus } from '../lib/spectre/useIdentitySession.ts'

export default function IdentityScreen(props: {
  identity: Identity
  sessionStatus: () => SessionStatus
  sessionIdentityId: () => string | null
  onUnlockIdentity: (identity: Identity, passphrase: string) => Promise<boolean>
  onBack: () => void
  onLockSession: () => void
  onDerive: (site: Site) => Promise<string | undefined>
  onAddSite: (identityId: string, site: Site) => void
  onUpdateSite: (identityId: string, site: Site, draft: SiteFormState) => void
  onDeleteSite: (identityId: string, siteId: string) => void
}) {
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

  let copyTimer: number | null = null
  onCleanup(() => {
    if (copyTimer !== null) clearTimeout(copyTimer)
  })

  // A ready session unlocked for a different identity must not serve this
  // identity's sites — treat it as idle and lock the stale session.
  const effective = createMemo((): SessionStatus => {
    const s = props.sessionStatus()
    if (s.kind === 'ready' && props.sessionIdentityId() !== props.identity.id) {
      return { kind: 'idle' }
    }
    return s
  })
  createEffect(
    () => {
      const s = props.sessionStatus()
      return (
        s.kind === 'ready' && props.sessionIdentityId() !== props.identity.id
      )
    },
    // Locking the stale session reads its own signals past the callback
    // boundary — the structural rule can't see the createEffect context.
    // eslint-disable-next-line solid/reactivity
    (mismatch) => {
      if (mismatch) props.onLockSession()
    },
  )

  const errorMsg = createMemo(() => {
    const s = effective()
    return s.kind === 'error' ? (
      <p class="text-sm text-red-400">{s.message}</p>
    ) : null
  })

  const onUnlockIdentity = async (): Promise<void> => {
    const done = await props.onUnlockIdentity(props.identity, passphrase())
    if (done) {
      setPassphrase('')
      setRecent(null)
    }
  }

  const onAddSite = async (): Promise<void> => {
    const n = newSite()
    if (!n.name.trim()) return
    const site: Site = {
      id:
        crypto.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: n.name.trim(),
      counter: n.counter,
      template: n.template,
      purpose: n.purpose,
      answer:
        n.purpose === 'answer' && n.answer.trim() ? n.answer.trim() : undefined,
    }
    props.onAddSite(props.identity.id, site)
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
    const d = editDraft()
    if (!d.name.trim()) return
    props.onUpdateSite(props.identity.id, site, d)
    setEditingId(null)
    setRecent(null)
    setCopiedId(null)
  }

  const onDeleteSite = async (site: Site): Promise<void> => {
    props.onDeleteSite(props.identity.id, site.id)
    setEditingId(null)
    setRecent(null)
    setCopiedId(null)
  }

  const onDerive = async (site: Site): Promise<void> => {
    setDerivingId(site.id) // optimistic pending — row shows "Deriving…"
    const value = await props.onDerive(site)
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
    <div
      data-screen="identity"
      data-id={props.identity.id}
      class="flex flex-col gap-4"
    >
      <div class="flex items-center justify-between">
        <p class="text-lg font-medium text-slate-100">
          {props.identity.fullName}
        </p>
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          onClick={() => props.onBack()}
        >
          ← identities
        </button>
      </div>

      <Show
        when={effective().kind === 'idle' || effective().kind === 'error'}
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
            onInput={(e) => setPassphrase((e.target as HTMLInputElement).value)}
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
        when={effective().kind === 'ready'}
        fallback={
          <Show when={effective().kind === 'working'}>
            <p class="text-sm text-teal-spectre">Deriving…</p>
          </Show>
        }
      >
        <div class="flex flex-col gap-2">
          <p class="text-xs text-slate-500">
            Tap a site to reveal it; tap the value to copy (auto-clears after
            30s).
          </p>
          <For each={props.identity.sites}>
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
