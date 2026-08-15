import { createEffect, For, Show } from 'solid-js'
import { Button, Card, Hint, Text } from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'
import { syncNow } from '../lib/sync/bridge.ts'
import { deleteIdentity } from '../lib/vault/mutations.ts'
import type { Identity } from '../lib/vault/schema.ts'

/** `/` — the identity list. Add form + vault settings live on `/settings`. */
export default function IdentitiesScreen() {
  const { api, view, navigate } = useScreen()

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
    const ok = await api.commitMutation(next)
    if (ok) api.session.lock()
  }

  const count = (): number => api.vaultValue()?.identities.length ?? 0

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
      <Show when={count() === 0}>
        <Card variant="dashed">
          <Hint>No identities yet — add your first one:</Hint>
          <Button variant="primary" onClick={() => navigate('/settings')}>
            Add identity
          </Button>
        </Card>
      </Show>
      <Show when={count() > 0}>
        <button
          class="self-start text-xs text-slate-500 underline hover:text-slate-300"
          onClick={() => navigate('/settings')}
        >
          ⚙ Settings
        </button>
      </Show>
    </div>
  )
}
