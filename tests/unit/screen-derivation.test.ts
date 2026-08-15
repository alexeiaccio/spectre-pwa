import { beforeAll, expect, test } from 'vitest'
import { deriveScreen } from '../../src/lib/navigation/screen.ts'
import type { ScreenDerivation } from '../../src/lib/navigation/screen.ts'
import type { SessionStatus } from '../../src/lib/spectre/use-identity-session.ts'
import { SpectreSession } from '../../src/lib/spectre/spectre-session.ts'
import type { VaultStatus } from '../../src/lib/vault/use-vault.ts'
import type { Vault } from '../../src/lib/vault/schema.ts'

const VAULT: Vault = { formatVersion: 1, identities: [] }

const IDENTITY: Vault['identities'][number] = {
  id: 'test',
  fullName: 'Robert Lee Mitchell',
  algorithm: 3,
  sites: [],
}

// Vault whose single identity matches the '/identity/abc' urls below.
const VAULT_WITH_ABC: Vault = {
  formatVersion: 1,
  identities: [{ ...IDENTITY, id: 'abc', fullName: 'Ada' }],
}

const IDLE: SessionStatus = { kind: 'idle' }
const WORKING: SessionStatus = { kind: 'working' }
const SESSION_ERROR: SessionStatus = { kind: 'error', message: 'derive failed' }

let READY: SessionStatus

beforeAll(async () => {
  const session = await SpectreSession.unlock(
    IDENTITY,
    'banana colored duckling',
  )
  READY = { kind: 'ready', session }
})

interface Case {
  name: string
  vault: VaultStatus
  session?: SessionStatus
  url: string
  expected: ScreenDerivation
}

const cases: Case[] = [
  // booting — transient, URL is never corrected
  {
    name: 'booting at /',
    vault: { kind: 'booting' },
    url: '/',
    expected: { screen: { view: 'booting' }, redirect: { kind: 'none' } },
  },
  {
    name: 'booting at a deep link',
    vault: { kind: 'booting' },
    url: '/identity/abc',
    expected: { screen: { view: 'booting' }, redirect: { kind: 'none' } },
  },
  {
    name: 'booting at an unmatched url',
    vault: { kind: 'booting' },
    url: '/nope',
    expected: { screen: { view: 'booting' }, redirect: { kind: 'none' } },
  },
  // needs-setup — any url lands on /setup
  {
    name: 'needs-setup at / redirects to /setup',
    vault: { kind: 'needs-setup' },
    url: '/',
    expected: {
      screen: { view: 'setup' },
      redirect: { kind: 'redirect', to: '/setup', replace: true },
    },
  },
  {
    name: 'needs-setup already at /setup keeps the url',
    vault: { kind: 'needs-setup' },
    url: '/setup',
    expected: { screen: { view: 'setup' }, redirect: { kind: 'none' } },
  },
  {
    name: 'needs-setup at a deep link redirects to /setup',
    vault: { kind: 'needs-setup' },
    url: '/identity/abc',
    expected: {
      screen: { view: 'setup' },
      redirect: { kind: 'redirect', to: '/setup', replace: true },
    },
  },
  // locked — a deep link must land on /locked (replace), never the deep link
  {
    name: 'locked at / redirects to /locked',
    vault: { kind: 'locked' },
    url: '/',
    expected: {
      screen: { view: 'locked' },
      redirect: { kind: 'redirect', to: '/locked', replace: true },
    },
  },
  {
    name: 'locked already at /locked keeps the url',
    vault: { kind: 'locked' },
    url: '/locked',
    expected: { screen: { view: 'locked' }, redirect: { kind: 'none' } },
  },
  {
    name: 'deep link /identity/abc while locked lands on the locked screen',
    vault: { kind: 'locked' },
    url: '/identity/abc',
    expected: {
      screen: { view: 'locked' },
      redirect: { kind: 'redirect', to: '/locked', replace: true },
    },
  },
  {
    name: 'unmatched url while locked redirects to /locked',
    vault: { kind: 'locked' },
    url: '/nope',
    expected: {
      screen: { view: 'locked' },
      redirect: { kind: 'redirect', to: '/locked', replace: true },
    },
  },
  // unlocked — url decides, wrong/unknown urls redirect to /
  {
    name: 'unlocked at / shows identities',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/',
    expected: { screen: { view: 'identities' }, redirect: { kind: 'none' } },
  },
  {
    name: 'unlocked at /setup redirects to /',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/setup',
    expected: {
      screen: { view: 'identities' },
      redirect: { kind: 'redirect', to: '/', replace: true },
    },
  },
  {
    name: 'unlocked at /locked redirects to /',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/locked',
    expected: {
      screen: { view: 'identities' },
      redirect: { kind: 'redirect', to: '/', replace: true },
    },
  },
  {
    name: 'unlocked deep link /identity/abc shows the identity with the url id',
    vault: { kind: 'unlocked', vault: VAULT_WITH_ABC },
    url: '/identity/abc',
    expected: {
      screen: { view: 'identity', id: 'abc', status: IDLE },
      redirect: { kind: 'none' },
    },
  },
  {
    name: 'unlocked /identity/<unknown uuid> redirects to /',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/identity/nope',
    expected: {
      screen: { view: 'identities' },
      redirect: { kind: 'redirect', to: '/', replace: true },
    },
  },
  {
    name: 'unlocked /identity/ without an id redirects to /',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/identity/',
    expected: {
      screen: { view: 'identities' },
      redirect: { kind: 'redirect', to: '/', replace: true },
    },
  },
  {
    name: 'unmatched url while unlocked redirects to /',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/nope',
    expected: {
      screen: { view: 'identities' },
      redirect: { kind: 'redirect', to: '/', replace: true },
    },
  },
  // vault error — a screen, not a route; the url is left alone
  {
    name: 'vault error at / shows the error screen',
    vault: { kind: 'error', message: 'boom' },
    url: '/',
    expected: {
      screen: { view: 'error', message: 'boom' },
      redirect: { kind: 'none' },
    },
  },
  {
    name: 'vault error at a deep link shows the error screen',
    vault: { kind: 'error', message: 'boom' },
    url: '/identity/abc',
    expected: {
      screen: { view: 'error', message: 'boom' },
      redirect: { kind: 'none' },
    },
  },
  // join — reachable from needs-setup and locked; booting/error dominate
  {
    name: 'needs-setup at /join shows the join screen',
    vault: { kind: 'needs-setup' },
    url: '/join',
    expected: { screen: { view: 'join' }, redirect: { kind: 'none' } },
  },
  {
    name: 'locked at /join shows the join screen',
    vault: { kind: 'locked' },
    url: '/join',
    expected: { screen: { view: 'join' }, redirect: { kind: 'none' } },
  },
  {
    name: 'unlocked at /join shows the join screen (existing-vault adopt-code join)',
    vault: { kind: 'unlocked', vault: VAULT },
    url: '/join',
    expected: { screen: { view: 'join' }, redirect: { kind: 'none' } },
  },
  {
    name: 'booting at /join keeps booting',
    vault: { kind: 'booting' },
    url: '/join',
    expected: { screen: { view: 'booting' }, redirect: { kind: 'none' } },
  },
]

test.each(cases)('$name', ({ vault, session, url, expected }) => {
  expect(deriveScreen(vault, session ?? IDLE, url)).toEqual(expected)
})

test.each([
  ['idle', IDLE],
  ['working', WORKING],
  ['ready', READY],
  ['error', SESSION_ERROR],
] as const)('identity screen carries the %s session status', (name, status) => {
  expect(
    deriveScreen(
      { kind: 'unlocked', vault: VAULT_WITH_ABC },
      status,
      '/identity/abc',
    ),
  ).toEqual({
    screen: { view: 'identity', id: 'abc', status },
    redirect: { kind: 'none' },
  })
})
