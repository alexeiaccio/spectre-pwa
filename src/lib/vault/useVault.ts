import { createSignal } from 'solid-js'
import { Effect } from 'effect'
import { vaultImpl } from './service.ts'
import {
  hasLegacyVault,
  readDeviceEnvelope,
  readMeta,
  readPrefs,
  writePrefs,
} from './storage.ts'
import type { AesKey } from './crypto-dek.ts'
import type { Envelope, Prefs, Vault, WrappedDeK } from './schema.ts'
import type { SyncRecord } from '../sync/types.ts'

const DEFAULT_PREFS: Prefs = { theme: 'dark', autoLockMinutes: 2 }

export type VaultStatus =
  | { kind: 'booting' }
  | { kind: 'needs-setup' }
  | { kind: 'needs-migration' }
  | { kind: 'locked' }
  | { kind: 'unlocked'; vault: Vault }
  | { kind: 'error'; message: string }

export type VaultApi = ReturnType<typeof useVault>

const runPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect)

const messageOf = (e: unknown): string => {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const message = e.message
    if (typeof message === 'string') return message
  }
  return 'unknown error'
}

/**
 * Ask the browser to persist storage (eviction exemption). Best-effort; the
 * outcome can't be enforced from a web app. Called after the first successful
 * unlock — the user has just shown intent, and Chrome prompts for permission
 * on the storage origin the same way it does for notifications.
 */
const requestPersist = (): void => {
  void navigator.storage?.persist?.().catch(() => {})
}

/**
 * Owns the vault lifecycle for the UI: boot (detect fresh vs migration vs v3
 * locked), setup, unlock by passkey / recovery code, save, migrate, lock.
 * The underlying services are Effect services (single runtime); status is a Solid signal.
 */
export function useVault() {
  const [status, setStatus] = createSignal<VaultStatus>({ kind: 'booting' })
  const [busy, setBusy] = createSignal(false)
  // Writable memo: fn returns the settled prefs from storage (suspend until read),
  // setPrefs overrides locally for optimisic edits without re-running the source.
  // Failed reads fall back to defaults — prefs are non-secret, non-critical settings.
  const [prefs, setPrefs] = createSignal(async () => {
    try {
      return (await runPromise(readPrefs())) ?? DEFAULT_PREFS
    } catch {
      return DEFAULT_PREFS
    }
  })

  const fail = (e: unknown) =>
    setStatus({ kind: 'error', message: messageOf(e) })

  // Boot: v3 vault (migrated) → locked; legacy v1 blob → needs-migration; else fresh.
  const boot = (): void => {
    void runPromise(readMeta())
      .then(async (meta) => {
        if (meta?.migrated) {
          const envelope = await runPromise(readDeviceEnvelope(meta.deviceId))
          setStatus(
            envelope
              ? { kind: 'locked' }
              : { kind: 'error', message: 'vault store is inconsistent' },
          )
          return
        }
        const legacy = await runPromise(hasLegacyVault())
        setStatus(
          legacy ? { kind: 'needs-migration' } : { kind: 'needs-setup' },
        )
      })
      .catch(fail)
  }
  boot()

  const withBusy = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      fail(e)
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const setup = (
    recoveryCode: string,
  ): Promise<{ recoveryRecord: WrappedDeK; identity: Vault } | undefined> =>
    withBusy(async () => {
      const result: { recoveryRecord: WrappedDeK; identity: Vault } =
        await runPromise(vaultImpl.setup(recoveryCode))
      setStatus({ kind: 'unlocked', vault: result.identity })
      return result
    })

  const unlock = (): Promise<Vault | undefined> =>
    withBusy(async () => {
      const vault: Vault = await runPromise(vaultImpl.unlock())
      setStatus({ kind: 'unlocked', vault })
      requestPersist()
      return vault
    })

  const unlockWithRecovery = (code: string): Promise<Vault | undefined> =>
    withBusy(async () => {
      const vault: Vault = await runPromise(vaultImpl.unlockWithRecovery(code))
      setStatus({ kind: 'unlocked', vault })
      return vault
    })

  const migrate = (
    method: { kind: 'passkey' } | { kind: 'recovery'; code: string },
  ): Promise<Vault | undefined> =>
    withBusy(async () => {
      const { vault } = await runPromise(vaultImpl.migrate(method))
      setStatus({ kind: 'unlocked', vault })
      return vault
    })

  const reEnrollPasskey = (recoveryCode: string): Promise<Vault | undefined> =>
    withBusy(async () => {
      const { vault } = await runPromise(
        vaultImpl.reEnrollPasskey(recoveryCode),
      )
      setStatus({ kind: 'unlocked', vault })
      return vault
    })

  const save = (vault: Vault): Promise<boolean> =>
    withBusy(async () => {
      await runPromise(vaultImpl.save(vault))
      setStatus({ kind: 'unlocked', vault })
      return true
    }).then((v) => v === true)

  const importJoined = (joined: {
    deviceId: string
    envelope: Envelope
    records: Map<string, SyncRecord>
    dek: AesKey
  }): Promise<Vault | undefined> =>
    withBusy(async () => {
      const result = await runPromise(vaultImpl.joinImport(joined))
      setStatus({ kind: 'unlocked', vault: result.vault })
      return result.vault
    })

  const setAutoLockMinutes = async (minutes: number): Promise<boolean> => {
    // Update the selector optimistically first (the writable-memo setter overrides
    // locally without re-running the source), then persist; revert on failure.
    // eslint-disable-next-line solid/reactivity
    const current = prefs()
    const next: Prefs = { ...current, autoLockMinutes: minutes }
    setPrefs(next)
    try {
      await runPromise(writePrefs(next))
      return true
    } catch {
      setPrefs(current)
      return false
    }
  }

  const lock = (): void => {
    Effect.runSync(vaultImpl.lock())
    setStatus({ kind: 'locked' })
  }

  return {
    status,
    busy,
    prefs,
    setAutoLockMinutes,
    setup,
    unlock,
    unlockWithRecovery,
    migrate,
    reEnrollPasskey,
    save,
    importJoined,
    lock,
  }
}
