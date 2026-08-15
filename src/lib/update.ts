import { createSignal } from 'solid-js'
import { registerSW } from 'virtual:pwa-register'

export interface UpdateApi {
  /** True once a newer service worker is installed and waiting. */
  updateAvailable: () => boolean
  /** Activate the waiting worker and reload with the fresh bundle. */
  applyUpdate: () => void
}

/**
 * App-wide update prompt. With `registerType: 'prompt'` (vite.config.ts) the
 * new service worker waits instead of force-taking over, so the header can
 * surface an "Update available" button instead of silently serving a stale
 * cached build in an already-open installed PWA.
 */
export function useUpdate(): UpdateApi {
  const [available, setAvailable] = createSignal(false)
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => setAvailable(true),
  })
  return {
    updateAvailable: available,
    applyUpdate: () => void updateSW(true),
  }
}
