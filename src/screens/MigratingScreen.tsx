import { createSignal, Show } from 'solid-js'

export default function MigratingScreen(props: {
  onMigratePasskey: () => void
  onMigrateRecovery: (code: string) => void
}) {
  const [code, setCode] = createSignal('')
  const [codeOpen, setCodeOpen] = createSignal(false)
  return (
    <div data-screen="migrating" class="flex flex-col gap-4">
      <p class="text-lg font-medium text-slate-100">One-time vault upgrade</p>
      <p class="text-sm text-slate-400">
        Your vault uses an older storage format. Unlock it once to convert it to
        the new per-identity records — your data stays on this device.
      </p>
      <button
        class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black"
        onClick={props.onMigratePasskey}
      >
        Unlock &amp; migrate with passkey
      </button>
      <button
        class="text-xs text-slate-500 underline hover:text-slate-300"
        onClick={() => setCodeOpen((v) => !v)}
      >
        …or use your recovery code
      </button>
      <Show when={codeOpen()}>
        <div class="flex flex-col gap-2">
          <input
            class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            value={code()}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            placeholder="recovery code"
            type="password"
          />
          <button
            class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
            disabled={code().length < 8}
            onClick={() => props.onMigrateRecovery(code())}
          >
            Migrate with code
          </button>
        </div>
      </Show>
    </div>
  )
}
