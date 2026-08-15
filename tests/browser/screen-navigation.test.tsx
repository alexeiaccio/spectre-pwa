import { createSignal } from 'solid-js'
import { beforeEach, expect, test } from 'vitest'
import { render, waitFor } from '@solidjs/testing-library'
import App from '../../src/app.tsx'
import type { SessionApi } from '../../src/lib/spectre/use-identity-session.ts'
import type { SessionStatus } from '../../src/lib/spectre/use-identity-session.ts'
import type { VaultApi } from '../../src/lib/vault/use-vault.ts'
import type { VaultStatus } from '../../src/lib/vault/use-vault.ts'
import type { Vault } from '../../src/lib/vault/schema.ts'

const VAULT: Vault = {
  formatVersion: 1,
  identities: [{ id: 'abc-123', fullName: 'Robert', algorithm: 3, sites: [] }],
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
    setup: async () => undefined,
    unlock: async () => {
      setStatus({ kind: 'unlocked', vault: VAULT })
      return VAULT
    },
    unlockWithRecovery: async () => {
      setStatus({ kind: 'unlocked', vault: VAULT })
      return VAULT
    },
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

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

test('deep link to /identity/<uuid> while locked lands on the locked screen', async () => {
  window.history.replaceState({}, '', '/identity/abc-123')
  const { container } = render(() => (
    <App vault={fakeVault({ kind: 'locked' })} session={fakeSession()} />
  ))
  await waitFor(() => {
    expect(
      container.querySelector('[data-screen]')?.getAttribute('data-screen'),
    ).toBe('locked')
  })
  expect(window.location.pathname).toBe('/locked')
})

test('unlocked deep link to /identity/<uuid> renders the identity screen', async () => {
  window.history.replaceState({}, '', '/identity/abc-123')
  const { container } = render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT })}
      session={fakeSession()}
    />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="identity"]')).toBeTruthy()
  })
  const identity = container.querySelector('[data-screen="identity"]')
  expect(identity?.getAttribute('data-id')).toBe('abc-123')
  expect(window.location.pathname).toBe('/identity/abc-123')
})

test('unlock with passkey from locked navigates to the identities list', async () => {
  const { container } = render(() => (
    <App vault={fakeVault({ kind: 'locked' })} session={fakeSession()} />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="locked"]')).toBeTruthy()
  })
  const unlockBtn = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Unlock with passkey'),
  )
  unlockBtn?.click()
  await waitFor(() => {
    expect(container.querySelector('[data-screen="identities"]')).toBeTruthy()
  })
  expect(window.location.pathname).toBe('/')
})

test('deep link to /join from needs-setup renders the join screen', async () => {
  window.history.replaceState({}, '', '/join')
  const { container } = render(() => (
    <App vault={fakeVault({ kind: 'needs-setup' })} session={fakeSession()} />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="join"]')).toBeTruthy()
  })
  expect(window.location.pathname).toBe('/join')
  expect(container.textContent).toContain('Paste the invitation')
})
