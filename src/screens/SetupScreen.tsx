import { createSignal } from 'solid-js'

export default function SetupScreen(props: {
  onSubmit: (code: string) => void
  onJoin: () => void
}) {
  const [code, setCode] = createSignal('')
  return (
    <div data-screen="setup" class="flex flex-col gap-4">
      <p class="text-sm text-slate-400">
        First run — create your vault with a passkey. Add a recovery code as a
        second way in:
      </p>
      <input
        class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
        value={code()}
        onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        placeholder="recovery code"
      />
      <button
        class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black"
        onClick={() => props.onSubmit(code())}
      >
        Create vault
      </button>
      <button
        class="text-xs text-slate-500 underline hover:text-slate-300"
        onClick={() => props.onJoin()}
      >
        I have a vault on another device — join it
      </button>
    </div>
  )
}
