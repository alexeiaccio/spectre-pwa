import { Show } from 'solid-js'
import type { BeforeInstallPromptEvent } from '../lib/pwa.ts'
import { APP_VERSION } from '../lib/version.ts'

/**
 * Header actions share one compact shape (px-2 py-1 text-xs rounded) and differ
 * only in fill: Install = solid, Update = bright outline, Lock = muted outline.
 * (The `tap` min-height utility is intentionally not used here so the three
 * buttons stay the same height.)
 */
export default function Header(props: {
  installPrompt: () => BeforeInstallPromptEvent | null
  onInstall: () => void
  onLock: () => void
  updateAvailable: () => boolean
  onUpdate: () => void
}) {
  return (
    <header class="flex items-center justify-between gap-2 border-b border-surface-700 px-4 py-3">
      <div class="flex flex-col leading-tight">
        <h1 class="text-lg font-semibold text-slate-100">Spectre Pocket</h1>
        <span class="text-[10px] text-slate-600" data-testid="app-version">
          {APP_VERSION}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Show when={props.updateAvailable()}>
          <button
            class="rounded border border-teal-spectre px-2 py-1 text-xs font-medium text-teal-spectre hover:text-slate-200"
            onClick={() => props.onUpdate()}
          >
            Update available
          </button>
        </Show>
        <Show when={props.installPrompt()}>
          <button
            class="rounded bg-teal-spectre px-2 py-1 text-xs font-medium text-black"
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
