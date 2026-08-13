import { createSignal } from 'solid-js'
import { SpectreSession } from '../spectre/spectre-session.ts'
import type { Identity, Site } from '../vault/schema.ts'

export type SessionStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; session: SpectreSession }
  | { kind: 'error'; message: string }

/**
 * Holds the per-identity Spectre session (Gate 2 / T4). The passphrase is typed
 * once per identity; scrypt runs once, the master key is held as a non-extractable
 * HMAC CryptoKey inside SpectreSession, and passwords derive per-site on demand.
 */
export function useIdentitySession() {
  const [status, setStatus] = createSignal<SessionStatus>({ kind: 'idle' })

  const unlock = async (identity: Identity, passphrase: string): Promise<SpectreSession | undefined> => {
    setStatus({ kind: 'working' })
    try {
      const session = await SpectreSession.unlock(identity, passphrase)
      setStatus({ kind: 'ready', session })
      return session
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'unlock failed' })
      return undefined
    }
  }

  const derive = async (site: Site): Promise<string | undefined> => {
    const s = status()
    if (s.kind !== 'ready') return undefined
    try {
      return await s.session.password(site)
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'derive failed' })
      return undefined
    }
  }

  const lock = (): void => {
    const s = status()
    if (s.kind === 'ready') s.session.destroy()
    setStatus({ kind: 'idle' })
  }

  return { status, unlock, derive, lock }
}