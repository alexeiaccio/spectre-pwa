import { createEffect } from 'solid-js'
import IdentitiesScreen from '../screens/identities-screen.tsx'
import { getSyncAdapter } from '../lib/sync/adapter.ts'
import { shareVaultDoc } from '../lib/sync/pairing.ts'
import { syncNow } from '../lib/sync/bridge.ts'
import { deleteIdentity } from '../lib/vault/mutations.ts'
import { useScreen } from './use-screen.ts'
import type { Identity, Vault } from '../lib/vault/schema.ts'

const uid = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** `/` — the identity list. The only vault-backed home screen. */
export default function IdentitiesRoute() {
  const { api, view, navigate } = useScreen()

  // Inbound half of the bridge: re-read known keys into the mirror (experimental).
  createEffect(
    () => view('identities')(),
    (s) => {
      if (s) void syncNow()
    },
  )

  const onSaveIdentity = async (
    fullName: string,
    passphrase: string,
  ): Promise<void> => {
    const v = api.vaultValue()
    if (!v || !fullName.trim() || passphrase.length < 8) return
    const identity: Identity = {
      id: uid(),
      fullName: fullName.trim(),
      algorithm: 3,
      sites: [],
    }
    const next: Vault = { ...v, identities: [...v.identities, identity] }
    const ok = await api.commitMutation(next)
    if (ok) navigate(`/identity/${identity.id}`)
  }

  const onDeleteIdentity = async (identity: Identity): Promise<void> => {
    const v = api.vaultValue()
    if (!v) return
    const next: Vault = deleteIdentity(v, identity.id)
    const ok = await api.commitMutation(next)
    if (ok) api.session.lock()
  }

  return (
    <IdentitiesScreen
      vault={api.vaultValue() ?? { formatVersion: 1, identities: [] }}
      prefs={api.vault.prefs}
      onSelect={(id) => navigate(`/identity/${id}`)}
      onSaveIdentity={(fullName, passphrase) =>
        void onSaveIdentity(fullName, passphrase)
      }
      onDeleteIdentity={(identity) => void onDeleteIdentity(identity)}
      onReEnroll={(code) => api.vault.reEnrollPasskey(code)}
      onSetAutoLock={(minutes) =>
        void api.vault.setAutoLockMinutes(minutes)
      }
      onCreateInvitation={() => shareVaultDoc(getSyncAdapter())}
    />
  )
}
