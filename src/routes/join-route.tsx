import JoinScreen from '../screens/join-screen.tsx'
import { useScreen } from './use-screen.ts'

/**
 * `/join` — reachable from needs-setup and locked. deriveScreen redirects
 * other states away, so when this route is mounted its screen is active.
 */
export default function JoinRoute() {
  const { api, navigate } = useScreen()
  return (
    <JoinScreen
      vaultStatus={api.vault.status}
      onUnlockLocal={(method) =>
        method.kind === 'passkey'
          ? api.vault.unlock().then((v) => v !== undefined)
          : api.vault
              .unlockWithRecovery(method.code)
              .then((v) => v !== undefined)
      }
      onComplete={(joined) => api.vault.importJoined(joined)}
      onBack={() => navigate('/')}
    />
  )
}
