import { createSignal, Show } from 'solid-js'
import { Button, Hint, Input, Text } from '../components/ui/index.ts'

export default function LockedScreen(props: {
  onPasskey: () => void
  onRecovery: (code: string) => void
  onJoin: () => void
}) {
  const [code, setCode] = createSignal('')
  const [reEnrollOpen, setReEnrollOpen] = createSignal(false)
  return (
    <div data-screen="locked" class="flex flex-col gap-4">
      <Button variant="primary" onClick={() => props.onPasskey()}>
        Unlock with passkey
      </Button>
      <Text>…or with your recovery code:</Text>
      <div class="flex flex-col gap-2">
        <Input
          value={code()}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          placeholder="recovery code"
        />
        <Button variant="secondary" onClick={() => props.onRecovery(code())}>
          Unlock with code
        </Button>
        <button
          class="text-xs text-slate-500 underline hover:text-slate-300"
          onClick={() => setReEnrollOpen((v) => !v)}
        >
          Replace lost passkey…
        </button>
        <Show when={reEnrollOpen()}>
          <Hint>
            Unlock first (above), then confirm your recovery code here to enroll
            a new passkey.
          </Hint>
        </Show>
        <button
          class="text-xs text-slate-500 underline hover:text-slate-300"
          onClick={() => props.onJoin()}
        >
          I have a vault on another device — join it
        </button>
      </div>
    </div>
  )
}
