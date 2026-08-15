import { Show } from 'solid-js'
import ErrorScreen from '../screens/error-screen.tsx'
import { useScreen } from './use-screen.ts'

/**
 * `/*` catch-all. deriveScreen returns `booting` (transient) or `error`
 * regardless of URL, so this route renders either when active.
 */
export default function CatchAllRoute() {
  const { api, isA, view } = useScreen()
  return (
    <>
      <Show when={isA('booting')()}>
        <p data-screen="booting" class="text-sm text-slate-500">
          Opening vault…
        </p>
      </Show>
      <Show when={view('error')()} keyed>
        {(s) => (
          <ErrorScreen
            message={s.message}
            onRetry={() => void api.vault.unlock()}
          />
        )}
      </Show>
    </>
  )
}
