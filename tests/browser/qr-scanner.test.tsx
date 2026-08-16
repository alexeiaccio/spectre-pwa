import { createSignal } from 'solid-js'
import { expect, test } from 'vitest'
import { render, waitFor } from '@solidjs/testing-library'
import App from '../../src/app.tsx'
import type { SessionApi } from '../../src/lib/spectre/use-identity-session.ts'
import type { SessionStatus } from '../../src/lib/spectre/use-identity-session.ts'
import type { VaultApi } from '../../src/lib/vault/use-vault.ts'
import type { VaultStatus } from '../../src/lib/vault/use-vault.ts'
import type { Vault } from '../../src/lib/vault/schema.ts'

const VAULT: Vault = { formatVersion: 1, identities: [] }

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

/**
 * Regression guard for the camera flow: tapping "Scan QR" must actually call
 * getUserMedia (a non-reactive `let` ref previously made the setup effect see
 * undefined and never request the camera — the "Starting camera… with no
 * permission prompt" bug), and the scanner must reach a terminal state
 * (scanning hint when a camera works, or a visible error) instead of hanging.
 */
test('Scan QR requests the camera and does not hang on "Starting camera…"', async () => {
  window.history.replaceState({}, '', '/join')

  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  const calls: string[] = []
  navigator.mediaDevices.getUserMedia = (async (
    constraints: MediaStreamConstraints,
  ) => {
    calls.push(JSON.stringify(constraints))
    try {
      const stream = await gum(constraints)
      calls.push('resolved tracks=' + stream.getVideoTracks().length)
      return stream
    } catch (e) {
      calls.push('rejected ' + (e instanceof DOMException ? e.name : String(e)))
      throw e
    }
  }) as typeof navigator.mediaDevices.getUserMedia

  const { container } = render(() => (
    <App vault={fakeVault({ kind: 'needs-setup' })} session={fakeSession()} />
  ))
  const scanBtn = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Scan QR'),
  )
  expect(scanBtn).toBeTruthy()
  scanBtn?.click()

  await waitFor(
    () => {
      expect(
        calls.length,
        `getUserMedia calls: ${JSON.stringify(calls)}`,
      ).toBeGreaterThan(0)
    },
    { timeout: 10_000 },
  )

  await waitFor(
    () => {
      const text = container.textContent ?? ''
      const scanning = text.includes(
        'Point this device at the invitation QR code',
      )
      const errored = !!container.querySelector('.text-red-400')
      expect(scanning || errored, `text: ${text.slice(0, 200)}`).toBe(true)
    },
    { timeout: 10_000 },
  )
})
