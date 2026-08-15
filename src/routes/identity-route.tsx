import { Show } from 'solid-js'
import IdentityScreen from '../screens/identity-screen.tsx'
import { addSite, deleteSite, updateSite } from '../lib/vault/mutations.ts'
import { useScreen } from './use-screen.ts'
import type { Identity, Site } from '../lib/vault/schema.ts'
import type { SiteFormState } from '../screens/site-fields.tsx'

/** `/identity/:uuid` — one identity's sites. */
export default function IdentityRoute() {
  const { api, view, navigate } = useScreen()

  const onAddSite = async (identityId: string, site: Site): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    await api.commitMutation(addSite(v, identityId, site))
  }

  const onUpdateSite = async (
    identityId: string,
    site: Site,
    draft: SiteFormState,
  ): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    const updated: Site = {
      ...site,
      name: draft.name.trim(),
      counter: draft.counter,
      template: draft.template,
      purpose: draft.purpose,
      answer:
        draft.purpose === 'answer' && draft.answer.trim()
          ? draft.answer.trim()
          : undefined,
    }
    await api.commitMutation(updateSite(v, identityId, updated))
  }

  const onDeleteSite = async (
    identityId: string,
    siteId: string,
  ): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    await api.commitMutation(deleteSite(v, identityId, siteId))
  }

  const onUnlockIdentity = (
    identity: Identity,
    passphrase: string,
  ): Promise<boolean> =>
    api.session.unlock(identity, passphrase).then((s) => s !== undefined)

  const onDerive = (site: Site): Promise<string | undefined> =>
    api.session.derive(site)

  const onBack = (): void => {
    api.session.lock()
    navigate('/')
  }

  return (
    <Show when={view('identity')()} keyed>
      {(s) => {
        const found = api.vaultValue()?.identities.find((i) => i.id === s.id)
        return found ? (
          <IdentityScreen
            identity={found}
            sessionStatus={api.session.status}
            sessionIdentityId={api.session.identityId}
            onUnlockIdentity={onUnlockIdentity}
            onBack={onBack}
            onLockSession={api.session.lock}
            onDerive={onDerive}
            onAddSite={(id, site) => void onAddSite(id, site)}
            onUpdateSite={(id, site, draft) =>
              void onUpdateSite(id, site, draft)
            }
            onDeleteSite={(id, siteId) => void onDeleteSite(id, siteId)}
          />
        ) : null
      }}
    </Show>
  )
}
