import {
  createEffect,
  createMemo,
  createOptimistic,
  createSignal,
  onCleanup,
  For,
  Show,
} from 'solid-js'
import {
  Accent,
  Button,
  Card,
  Hint,
  Input,
  Text,
} from '../components/ui/index.ts'
import { PURPOSE_LABEL, NEW_SITE_DRAFT, SiteFields } from './site-fields.tsx'
import type { SiteFormState } from './site-fields.tsx'
import { copyWithAutoClear } from '../lib/lifecycle.ts'
import { useScreen } from '../lib/flow.ts'
import { addSite, deleteSite, updateSite } from '../lib/vault/mutations.ts'
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

  let copyTimer: number | null = null
  onCleanup(() => {
    if (copyTimer !== null) clearTimeout(copyTimer)
  })

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
  const onUnlockIdentity = async (): Promise<void> => {
    const id = identity()
    if (!id) return
    const done = await api.session.unlock(id, passphrase())
    if (done) {
      setPassphrase('')
      setRecent(null)
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
      <Hint>Add a site (derives on demand, no stored secrets):</Hint>
      <SiteFields
        draft={newSite()}
        setDraft={setNewSite}
        namePlaceholder="site name, e.g. twitter.com"
        collapsible
      />
      <Button variant="primary" onClick={() => void onAddSite()}>
        Add site
      </Button>
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
        <div class="flex flex-col gap-2">
          {errorMsg()}
          <Text>
            This identity is passphrase-locked. The secret is derived once per
            session:
          </Text>
          <Input
            value={passphrase()}
            onInput={(e) => setPassphrase((e.target as HTMLInputElement).value)}
            placeholder="Spectre passphrase"
            type="password"
          />
          <Button variant="primary" onClick={() => void onUnlockIdentity()}>
            Unlock identity
          </Button>
        </div>
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
          <Hint>
            Tap a site to reveal it; tap the value to copy (auto-clears after
            30s).
          </Hint>
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
                        <Button
                          variant="primary"
                          onClick={() => void onUpdateSite(site)}
                        >
                          Save
                        </Button>
                        <Button variant="secondary" onClick={onCancelEdit}>
                          Cancel
                        </Button>
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
