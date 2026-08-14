import { createSignal, Show } from 'solid-js'
import {
  Input as TextFieldInput,
  Root as TextFieldRoot,
} from '@kobalte/core/text-field'

export default function LockedScreen(props: {
  onPasskey: () => void
  onRecovery: (code: string) => void
  onJoin: () => void
}) {
  const [code, setCode] = createSignal('')
  const [reEnrollOpen, setReEnrollOpen] = createSignal(false)
  return (
    <div data-screen="locked" class="flex flex-col gap-4">
      <button
        class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black"
        onClick={() => props.onPasskey()}
      >
        Unlock with passkey
      </button>
      <p class="text-sm text-slate-400">…or with your recovery code:</p>
      <div class="flex flex-col gap-2">
        <TextFieldRoot>
          <TextFieldInput
            class="tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            value={code()}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            placeholder="recovery code"
          />
        </TextFieldRoot>
        <button
          class="tap rounded border border-surface-700 px-2 py-1 text-sm text-slate-300"
          onClick={() => props.onRecovery(code())}
        >
          Unlock with code
        </button>
        <button
          class="text-xs text-slate-500 underline hover:text-slate-300"
          onClick={() => setReEnrollOpen((v) => !v)}
        >
          Replace lost passkey…
        </button>
        <Show when={reEnrollOpen()}>
          <p class="text-xs text-slate-500">
            Unlock first (above), then confirm your recovery code here to enroll
            a new passkey.
          </p>
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
