import { onCleanup } from 'solid-js'

/**
 * T4 lock lifecycle: boot locked; "launch" = every foregrounding. On `hidden`
 * we start the grace clock; returning within `graceMs` stays unlocked,
 * past it we full re-auth (both gates). Terminal events (freeze, pagehide,
 * beforeunload) lock immediately, best-effort.
 *
 * Reads no signals at setup time — handlers capture current state when they run.
 */
export function useLockLifecycle(onLock: () => void, isOpen: () => boolean, graceMs: () => number) {
  let hiddenAt: number | null = null

  const onVisibility = (): void => {
    if (document.hidden) {
      hiddenAt = Date.now()
    } else if (hiddenAt !== null) {
      const elapsed = Date.now() - hiddenAt
      hiddenAt = null
      if (elapsed >= graceMs() && isOpen()) onLock()
    }
  }
  const lockNow = (): void => {
    if (isOpen()) onLock()
  }

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('freeze', lockNow)
  window.addEventListener('pagehide', lockNow)
  window.addEventListener('beforeunload', lockNow)

  onCleanup(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('freeze', lockNow)
    window.removeEventListener('pagehide', lockNow)
    window.removeEventListener('beforeunload', lockNow)
  })
}

/** ~30s self-clearing clipboard copy. Best-effort: only works while page is focused. */
export function copyWithAutoClear(value: string): void {
  const w = navigator.clipboard?.writeText(value)
  if (w) void w.then(() => {
    if (clipboardTimer !== null) clearTimeout(clipboardTimer)
    clipboardTimer = window.setTimeout(() => void navigator.clipboard?.writeText(''), 30_000)
  })
}

/** Clears the pending clipboard wipe (e.g. on lock) — hygiene, not a guarantee. */
export function clearClipboardTimer(): void {
  if (clipboardTimer !== null) {
    clearTimeout(clipboardTimer)
    clipboardTimer = null
  }
}

let clipboardTimer: number | null = null
