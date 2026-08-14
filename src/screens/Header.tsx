import { Show } from 'solid-js'
import type { BeforeInstallPromptEvent } from '../lib/pwa.ts'

export default function Header(props: {
  installPrompt: () => BeforeInstallPromptEvent | null
  onInstall: () => void
  onLock: () => void
}) {
  return (
    <header class="flex items-center justify-between gap-2 border-b border-surface-700 px-4 py-3">
      <h1 class="text-lg font-semibold text-slate-100">Spectre Pocket</h1>
      <div class="flex items-center gap-2">
        <Show when={props.installPrompt()}>
          <button
            class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black"
            onClick={() => props.onInstall()}
          >
            Install
          </button>
        </Show>
        <button
          class="rounded border border-surface-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          onClick={() => props.onLock()}
        >
          Lock
        </button>
      </div>
    </header>
  )
}
