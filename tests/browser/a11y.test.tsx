import { createSignal } from 'solid-js'
import { beforeEach, expect, test } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import App from '../../src/app.tsx'
import type {
  SessionApi,
  SessionStatus,
} from '../../src/lib/spectre/use-identity-session.ts'
import type { SpectreSession } from '../../src/lib/spectre/spectre-session.ts'
import type { VaultApi } from '../../src/lib/vault/use-vault.ts'
import type { VaultStatus } from '../../src/lib/vault/use-vault.ts'
import type { Vault } from '../../src/lib/vault/schema.ts'

const VAULT: Vault = {
  formatVersion: 1,
  identities: [{ id: 'abc-123', fullName: 'Robert', algorithm: 3, sites: [] }],
}

interface Calls {
  setup: string[]
  setupRecoveryOnly: string[]
  unlock: number
  unlockWithRecovery: string[]
  save: number
}

const newCalls = (): Calls => ({
  setup: [],
  setupRecoveryOnly: [],
  unlock: 0,
  unlockWithRecovery: [],
  save: 0,
})

function fakeVault(initial: VaultStatus, calls: Calls): VaultApi {
  const [status, setStatus] = createSignal<VaultStatus>(initial)
  const [busy] = createSignal(false)
  const [prefs] = createSignal({ theme: 'dark', autoLockMinutes: 2 })
  return {
    status,
    busy,
    prefs: prefs as unknown as VaultApi['prefs'],
    setAutoLockMinutes: async () => true,
    hasPasskey: () => true,
    setup: async (code) => {
      calls.setup.push(code)
      setStatus({ kind: 'unlocked', vault: VAULT })
      return { identity: VAULT, passkeyEnrolled: true }
    },
    setupRecoveryOnly: async (code) => {
      calls.setupRecoveryOnly.push(code)
      setStatus({ kind: 'unlocked', vault: VAULT })
      return VAULT
    },
    unlock: async () => {
      calls.unlock += 1
      setStatus({ kind: 'unlocked', vault: VAULT })
      return VAULT
    },
    unlockWithRecovery: async (code) => {
      calls.unlockWithRecovery.push(code)
      setStatus({ kind: 'unlocked', vault: VAULT })
      return VAULT
    },
    reEnrollPasskey: async () => VAULT,
    save: async () => {
      calls.save += 1
      return true
    },
    lock: () => setStatus({ kind: 'locked' }),
  }
}

function fakeSession(unlocked: string[][] = []): SessionApi {
  const [status, setStatus] = createSignal<SessionStatus>({ kind: 'idle' })
  const [identityId] = createSignal<string | null>(null)
  return {
    status,
    identityId,
    unlock: async (identity, passphrase) => {
      unlocked.push([identity.fullName, passphrase])
      setStatus({ kind: 'ready' })
      return {} as SpectreSession
    },
    derive: async () => undefined,
    lock: () => setStatus({ kind: 'idle' }),
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

const fill = async (input: HTMLElement, value: string): Promise<void> => {
  fireEvent.input(input, { target: { value } })
  await Promise.resolve()
}

test('setup: recovery-code field is labelled and the form submits vault.setup', async () => {
  const calls = newCalls()
  render(() => (
    <App
      vault={fakeVault({ kind: 'needs-setup' }, calls)}
      session={fakeSession()}
    />
  ))
  const input = await screen.findByLabelText('Recovery code')
  await fill(input, 'my-recovery')
  const form = (await screen.findByText('Create vault with passkey')).closest(
    'form',
  )
  expect(form).toBeTruthy()
  fireEvent.submit(form!)
  await waitFor(() => expect(calls.setup).toEqual(['my-recovery']))
})

test('locked: recovery-code field is labelled and the form submits unlockWithRecovery', async () => {
  const calls = newCalls()
  render(() => (
    <App vault={fakeVault({ kind: 'locked' }, calls)} session={fakeSession()} />
  ))
  const input = await screen.findByLabelText('Recovery code')
  await fill(input, 'my-recovery')
  const form = (await screen.findByText('Unlock with code')).closest('form')
  fireEvent.submit(form!)
  await waitFor(() => expect(calls.unlockWithRecovery).toEqual(['my-recovery']))
})

test('identity unlock: passphrase field is labelled and the form submits session.unlock', async () => {
  const unlocked: string[][] = []
  window.history.replaceState({}, '', '/identity/abc-123')
  render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT }, newCalls())}
      session={fakeSession(unlocked)}
    />
  ))
  const input = await screen.findByLabelText('Spectre passphrase')
  await fill(input, 'correct-horse-battery')
  const form = (await screen.findByText('Unlock identity')).closest('form')
  fireEvent.submit(form!)
  await waitFor(() =>
    expect(unlocked).toEqual([['Robert', 'correct-horse-battery']]),
  )
})

test('settings: add-identity fields are labelled and the form commits the identity', async () => {
  const calls = newCalls()
  window.history.replaceState({}, '', '/settings')
  render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT }, calls)}
      session={fakeSession()}
    />
  ))
  await fill(await screen.findByLabelText('Full name'), 'Ada Lovelace')
  await fill(
    await screen.findByLabelText('Passphrase'),
    'correct-horse-battery',
  )
  const form = (await screen.findByText('Add identity')).closest('form')
  fireEvent.submit(form!)
  await waitFor(() => expect(calls.save).toBe(1))
})

test('settings: identicon placeholder stays hidden until name + passphrase yield a figure', async () => {
  window.history.replaceState({}, '', '/settings')
  render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT }, newCalls())}
      session={fakeSession()}
    />
  ))
  const hint = await screen.findByText(
    'Add an identity (passphrase is your Spectre secret):',
  )
  const icon = hint.closest('form')!.querySelector('span[aria-hidden="true"]')!
  expect(icon.classList.contains('invisible')).toBe(true)
  await fill(await screen.findByLabelText('Full name'), 'Ada Lovelace')
  await fill(
    await screen.findByLabelText('Passphrase'),
    'correct-horse-battery',
  )
  await waitFor(() => expect(icon.classList.contains('invisible')).toBe(false))
})

test('join: invitation field is labelled inside a form with a submit action', async () => {
  window.history.replaceState({}, '', '/join')
  render(() => (
    <App
      vault={fakeVault({ kind: 'needs-setup' }, newCalls())}
      session={fakeSession()}
    />
  ))
  const textarea = await screen.findByLabelText('Invitation string')
  expect(textarea.tagName).toBe('TEXTAREA')
  const joinBtn = await screen.findByText('Join')
  expect(joinBtn.getAttribute('type')).toBe('submit')
  expect(joinBtn.closest('form')).toBeTruthy()
})

test('identities: icon-only delete buttons carry an aria-label', async () => {
  render(() => (
    <App
      vault={fakeVault({ kind: 'unlocked', vault: VAULT }, newCalls())}
      session={fakeSession()}
    />
  ))
  const del = await screen.findByLabelText('Delete identity Robert')
  expect(del.textContent).toBe('✕')
})
