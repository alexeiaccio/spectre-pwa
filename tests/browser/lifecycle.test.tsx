import { createSignal } from 'solid-js'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render } from '@solidjs/testing-library'
import App from '../../src/app.tsx'
import type { SessionApi } from '../../src/lib/spectre/use-identity-session.ts'
import type { SessionStatus } from '../../src/lib/spectre/use-identity-session.ts'
import type { VaultApi } from '../../src/lib/vault/use-vault.ts'
import type { VaultStatus } from '../../src/lib/vault/use-vault.ts'
import type { Vault } from '../../src/lib/vault/schema.ts'

const VAULT: Vault = {
  formatVersion: 1,
  identities: [],
}

function fakeVault(initial: VaultStatus): VaultApi {
  const [status, setStatus] = createSignal<VaultStatus>(initial)
  const [busy] = createSignal(false)
  const [prefs] = createSignal({ theme: 'dark', autoLockMinutes: 2 })
  return {
    status,
    busy,
    prefs: prefs as unknown as VaultApi['prefs'],
    setAutoLockMinutes: async () => true,
    hasPasskey: () => true,
    setup: async () => undefined,
    setupRecoveryOnly: async () => VAULT,
    unlock: async () => VAULT,
    unlockWithRecovery: async () => VAULT,
    reEnrollPasskey: async () => VAULT,
    save: async () => true,
    lock: () => setStatus({ kind: 'locked' }),
  }
}

function fakeSession(): SessionApi {
  const [status] = createSignal<SessionStatus>({ kind: 'idle' })
  const [identityId] = createSignal<string | null>(null)
  return {
    status,
    identityId,
    unlock: async () => undefined,
    derive: async () => undefined,
    lock: () => {},
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
})

test('unlocked app auto-locks after the inactivity grace with no interaction', async () => {
  vi.useFakeTimers()
  const { container } = render(() => (
    <App vault={fakeVault({ kind: 'unlocked', vault: VAULT })} session={fakeSession()} />
  ))
  await flush() // let the mount effect arm the idle timer
  vi.advanceTimersByTime(2 * 60 * 1000 + 1) // past the 2-minute default grace
  await flush()
  expect(container.querySelector('[data-screen="locked"]')).toBeTruthy()
})

test('interaction before the grace resets the idle timer', async () => {
  vi.useFakeTimers()
  const { container } = render(() => (
    <App vault={fakeVault({ kind: 'unlocked', vault: VAULT })} session={fakeSession()} />
  ))
  await flush()
  // interact mid-way through the grace, then advance past it again
  vi.advanceTimersByTime(60 * 1000)
  window.dispatchEvent(new Event('pointerdown'))
  await flush()
  vi.advanceTimersByTime(60 * 1000 + 1)
  await flush()
  expect(container.querySelector('[data-screen="locked"]')).toBeNull()
})
