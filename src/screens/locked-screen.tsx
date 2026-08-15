import { createSignal, Show } from 'solid-js'
import { Button, Hint, Input, Text } from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'

/** `/locked` — vault locked. */
export default function LockedScreen() {
  const { api, navigate } = useScreen()
  const [code, setCode] = createSignal('')
  const [reEnrollOpen, setReEnrollOpen] = createSignal(false)
  return (
    <div data-screen="locked" class="flex flex-col gap-4">
      <Show when={api.vault.hasPasskey()}>
        <Button variant="primary" onClick={() => void api.vault.unlock()}>
          Unlock with passkey
        </Button>
      </Show>
      <Show when={!api.vault.hasPasskey()}>
        <Hint>
          No passkey on this device — unlock with your recovery code below.
        </Hint>
      </Show>
      <Text>…or with your recovery code:</Text>
      <div class="flex flex-col gap-2">
        <Input
          value={code()}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          placeholder="recovery code"
        />
        <Button
          variant="secondary"
          onClick={() => void api.vault.unlockWithRecovery(code())}
        >
          Unlock with code
        </Button>
        <button
          class="text-xs text-slate-500 underline hover:text-slate-300"
          onClick={() => setReEnrollOpen((v) => !v)}
        >
          Add or replace a passkey…
        </button>
        <Show when={reEnrollOpen()}>
          <Hint>
            Unlock first (above), then confirm your recovery code here to enroll
            a passkey.
          </Hint>
        </Show>
        <button
          class="text-xs text-slate-500 underline hover:text-slate-300"
          onClick={() => navigate('/join')}
        >
          I have a vault on another device — join it
        </button>
      </div>
    </div>
  )
}
