import SetupScreen from '../screens/setup-screen.tsx'
import { useScreen } from './use-screen.ts'

/**
 * `/setup` — first run. deriveScreen redirects all non-setup urls here, so when
 * this route is mounted its screen is active; no local guard needed.
 */
export default function SetupRoute() {
  const { api, navigate } = useScreen()
  return (
    <SetupScreen
      onSubmit={(code) => void api.vault.setup(code)}
      onJoin={() => navigate('/join')}
    />
  )
}
