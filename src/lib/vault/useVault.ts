import { createSignal } from 'solid-js'
import { Effect } from 'effect'
import { vaultImpl } from './service.ts'
import { readEnvelope, readPrefs, writePrefs } from './storage.ts'
import type { Prefs, Vault, WrappedDeK } from './schema.ts'

const DEFAULT_PREFS: Prefs = { theme: 'dark', autoLockMinutes: 2 }

export type VaultStatus =
  | { kind: 'booting' }
  | { kind: 'needs-setup' }
  | { kind: 'locked' }
  | { kind: 'unlocked'; vault: Vault }
  | { kind: 'error'; message: string }

export type VaultApi = ReturnType<typeof useVault>

const runPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect)

const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as Error).message)
    : 'unknown error'

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
 * Owns the vault lifecycle for the UI: boot (detect setup vs locked), setup,
 * unlock by passkey, unlock by recovery code, save, lock.
 * The underlying services are module-level (single-instance); status is a Solid signal.
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

  // Boot: detect setup vs locked. One-shot side effect — Solid 2 beta's createEffect
  // requires (compute, effect) and won't accept a single side-effect fn, so call directly.
  const boot = (): void => {
    void runPromise(readEnvelope())
      .then((env) =>
        setStatus(env ? { kind: 'locked' } : { kind: 'needs-setup' }),
      )
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

  const setAutoLockMinutes = (minutes: number): Promise<boolean> =>
    // Update the selector optimistically first (the writable-memo setter overrides
    // locally without re-running the source), then persist; revert on failure.
    // eslint-disable-next-line solid/reactivity
    new Promise<boolean>((resolve) => {
      const current = prefs()
      const next: Prefs = { ...current, autoLockMinutes: minutes }
      setPrefs(next)
      runPromise(writePrefs(next))
        .then(() => resolve(true))
        .catch(() => {
          setPrefs(current)
          resolve(false)
        })
    })

  const lock = (): void => {
    vaultImpl.lock()
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
    reEnrollPasskey,
    save,
    lock,
  }
}
