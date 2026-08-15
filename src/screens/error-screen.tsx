import { createMemo, Show } from 'solid-js'
import { ErrorText } from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'

/** `/*` catch-all — renders while the vault boots or errored. */
export default function ErrorScreen() {
  const { api, isA } = useScreen()
  const message = createMemo(() => {
    const s = api.vault.status()
    return s.kind === 'error' ? s.message : ''
  })
  return (
    <Show when={isA('booting')() || isA('error')()}>
      <Show when={isA('booting')()}>
        <p data-screen="booting" class="text-sm text-slate-500">
          Opening vault…
        </p>
      </Show>
      <Show when={isA('error')()}>
        <div data-screen="error" class="flex flex-col gap-2">
          <ErrorText>{message()}</ErrorText>
          <button
            class="text-sm text-teal-spectre"
            onClick={() => void api.vault.unlock()}
          >
            Retry unlock
          </button>
        </div>
      </Show>
    </Show>
  )
}
