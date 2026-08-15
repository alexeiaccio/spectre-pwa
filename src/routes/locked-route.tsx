import LockedScreen from '../screens/locked-screen.tsx'
import { useScreen } from './use-screen.ts'

/**
 * `/locked` — vault locked. deriveScreen redirects all non-locked urls here,
 * so when this route is mounted its screen is active; no local guard needed.
 */
export default function LockedRoute() {
  const { api, navigate } = useScreen()
  return (
    <LockedScreen
      onPasskey={() => void api.vault.unlock()}
      onRecovery={(code) => void api.vault.unlockWithRecovery(code)}
      onJoin={() => navigate('/join')}
    />
  )
}
