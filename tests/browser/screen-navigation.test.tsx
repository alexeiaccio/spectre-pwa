import { createSignal } from 'solid-js'
import { beforeEach, expect, test } from 'vitest'
import { fireEvent, render, waitFor } from '@solidjs/testing-library'
import App from '../../src/app.tsx'
import type { SessionApi } from '../../src/lib/spectre/use-identity-session.ts'
import type { SessionStatus } from '../../src/lib/spectre/use-identity-session.ts'
import type { SpectreSession } from '../../src/lib/spectre/spectre-session.ts'
import type { VaultApi } from '../../src/lib/vault/use-vault.ts'
import type { VaultStatus } from '../../src/lib/vault/use-vault.ts'
import type { Vault } from '../../src/lib/vault/schema.ts'

const VAULT: Vault = {
  formatVersion: 1,
  identities: [{ id: 'abc-123', fullName: 'Robert', algorithm: 3, sites: [] }],
}

/** A ready identity session so the sites list renders (no passphrase prompt). */
function fakeReadySession(identityId = 'abc-123'): SessionApi {
  const [status] = createSignal<SessionStatus>({
    kind: 'ready',
    session: {
      identity: {
        id: identityId,
        fullName: 'Robert',
        algorithm: 3,
        sites: [],
      },
      password: async () => 'secret',
      destroy: () => {},
    } as unknown as SpectreSession,
  })
  const [id] = createSignal<string | null>(identityId)
  return {
    status,
    identityId: id,
    unlock: async () => undefined,
    derive: async () => 'secret',
    lock: () => {},
  }
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

test('unlocked deep link to /settings renders the settings screen', async () => {
  window.history.replaceState({}, '', '/settings')
  const { container } = render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT })}
      session={fakeSession()}
    />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="settings"]')).toBeTruthy()
  })
  expect(window.location.pathname).toBe('/settings')
})

test('identities screen links to settings when identities exist', async () => {
  window.history.replaceState({}, '', '/')
  const { container } = render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT })}
      session={fakeSession()}
    />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="identities"]')).toBeTruthy()
  })
  const link = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Settings'),
  )
  expect(link).toBeTruthy()
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
  expect(container.textContent).toContain('Enter the invitation')
})

test('identity screen search filters the site list (fuzzy)', async () => {
  window.history.replaceState({}, '', '/identity/abc-123')
  const withSites: Vault = {
    formatVersion: 1,
    identities: [
      {
        id: 'abc-123',
        fullName: 'Robert',
        algorithm: 3,
        sites: [
          { id: 's1', name: 'twitter.com', counter: 1, template: 17, purpose: 'password' },
          { id: 's2', name: 'github.com', counter: 1, template: 17, purpose: 'password' },
        ],
      },
    ],
  }
  const { container } = render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: withSites })}
      session={fakeReadySession()}
    />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="identity"]')).toBeTruthy()
  })
  expect(container.textContent).toContain('twitter.com')
  expect(container.textContent).toContain('github.com')

  const input = container.querySelector('input[title="Search sites"]') as HTMLInputElement
  fireEvent.input(input, { target: { value: 'twit' } })
  await waitFor(() => {
    expect(container.textContent).toContain('twitter.com')
    expect(container.textContent).not.toContain('github.com')
  })

  fireEvent.input(input, { target: { value: 'zzz' } })
  await waitFor(() => {
    expect(container.textContent).toContain('No sites match')
  })
})

test('empty identity shows the add-site icon; tapping it opens the add form', async () => {
  window.history.replaceState({}, '', '/identity/abc-123')
  const { container } = render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT })}
      session={fakeReadySession()}
    />
  ))
  await waitFor(() => {
    expect(container.querySelector('[data-screen="identity"]')).toBeTruthy()
  })
  const addIcon = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Add a site'),
  )
  expect(addIcon).toBeTruthy()
  // the full add form is hidden until the icon is tapped
  expect(container.textContent).not.toContain('Add a site (derives on demand')
  addIcon?.click()
  await waitFor(() => {
    expect(container.textContent).toContain('Add a site (derives on demand')
  })
})
