import { createSignal, onCleanup } from 'solid-js'

/** Chrome/Edge deferred install prompt (not part of the standard TS lib). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/** Chrome/Edge-only event; narrowed by the `prompt` member. */
const isBeforeInstallPrompt = (e: Event): e is BeforeInstallPromptEvent =>
  'prompt' in e

/**
 * PWA install prompt (Chrome/Edge). Fires only when installable and not yet
 * installed. Returns the current prompt (null after dismissed/installed) and an
 * onInstall handler that shows it.
 */
export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] =
    createSignal<BeforeInstallPromptEvent | null>(null)

  const onBeforeInstall = (e: Event): void => {
    e.preventDefault()
    if (isBeforeInstallPrompt(e)) setInstallPrompt(e)
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('appinstalled', () => setInstallPrompt(null))
  onCleanup(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  })

  const onInstall = (): void => {
    const evt = installPrompt()
    if (!evt) return
    void evt.prompt()
    setInstallPrompt(null)
  }

  return { installPrompt, onInstall }
}
