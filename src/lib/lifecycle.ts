import { createEffect, onCleanup } from 'solid-js'

/**
 * T4 lock lifecycle: boot locked; "launch" = every foregrounding. Two clocks:
 *
 * 1. **Visible idle timer** — while the app is open, any interaction
 *    (pointerdown/keydown/touchstart) re-arms a `graceMs` timer; it firing
 *    locks the app. Mirrors Bitwarden's "inactivity measured by interaction".
 * 2. **Background grace** — on `hidden` we start the grace clock; returning
 *    within `graceMs` stays unlocked, past it we full re-auth. Terminal events
 *    (freeze, pagehide, beforeunload) lock immediately, best-effort.
 *
 * Reads no signals at setup time — handlers capture current state when they run.
 */
export function useLockLifecycle(
  onLock: () => void,
  isOpen: () => boolean,
  graceMs: () => number,
) {
  let hiddenAt: number | null = null
  let idleTimer: number | null = null

  const clearIdle = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const armIdle = (): void => {
    clearIdle()
    if (!isOpen() || document.hidden) return
    idleTimer = window.setTimeout(() => {
      idleTimer = null
      if (!document.hidden && isOpen()) onLock()
    }, graceMs())
  }

  const onVisibility = (): void => {
    if (document.hidden) {
      hiddenAt = Date.now()
      clearIdle() // background grace takes over while hidden
    } else {
      armIdle() // re-arm the visible idle timer on return
      if (hiddenAt !== null) {
        const elapsed = Date.now() - hiddenAt
        hiddenAt = null
        if (elapsed >= graceMs() && isOpen()) onLock()
      }
    }
  }
  const onInteraction = (): void => {
    if (!document.hidden) armIdle()
  }
  const lockNow = (): void => {
    clearIdle()
    if (isOpen()) onLock()
  }

  // Arm/clear the idle timer as the open state flips (unlock → arm, lock → clear).
  createEffect(
    () => isOpen(),
    (open) => {
      if (open && !document.hidden) armIdle()
      else clearIdle()
    },
  )

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('freeze', lockNow)
  window.addEventListener('pagehide', lockNow)
  window.addEventListener('beforeunload', lockNow)
  window.addEventListener('pointerdown', onInteraction, true)
  window.addEventListener('keydown', onInteraction, true)
  window.addEventListener('touchstart', onInteraction, true)

  onCleanup(() => {
    clearIdle()
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('freeze', lockNow)
    window.removeEventListener('pagehide', lockNow)
    window.removeEventListener('beforeunload', lockNow)
    window.removeEventListener('pointerdown', onInteraction, true)
    window.removeEventListener('keydown', onInteraction, true)
    window.removeEventListener('touchstart', onInteraction, true)
  })
}

/** ~30s self-clearing clipboard copy. Best-effort: only works while page is focused. */
export function copyWithAutoClear(value: string): void {
  const w = navigator.clipboard?.writeText(value)
  if (w)
    void w.then(() => {
      if (clipboardTimer !== null) clearTimeout(clipboardTimer)
      clipboardTimer = window.setTimeout(
        () => void navigator.clipboard?.writeText(''),
        30_000,
      )
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
