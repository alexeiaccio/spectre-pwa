import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SpectreSession } from '../src/lib/spectre/spectre-session.ts'
import type { Identity, Site } from '../src/lib/vault/schema.ts'

const IDENTITY: Identity = {
  id: 'test',
  fullName: 'Robert Lee Mitchell',
  algorithm: 3,
  sites: [],
}

const SITE: Site = {
  id: 's1',
  name: 'masterpasswordapp.com',
  counter: 1,
  template: 17,
  purpose: 'password',
}

test('session password matches official V3 vector via held CryptoKey', async () => {
  const session = await SpectreSession.unlock(IDENTITY, 'banana colored duckling')
  assert.equal(await session.password(SITE), 'Jejr5[RepuSosp')
  session.destroy()
})

test('session holds a non-extractable master key', async () => {
  const session = await SpectreSession.unlock(IDENTITY, 'banana colored duckling')
  const key = (session as unknown as { masterKey: CryptoKey }).masterKey
  assert.equal(key.extractable, false)
  session.destroy()
})

test('password() throws after destroy()', async () => {
  const session = await SpectreSession.unlock(IDENTITY, 'banana colored duckling')
  session.destroy()
  await assert.rejects(() => session.password(SITE), /session locked/)
})

test('answer purpose passes the security question as context (official vector)', async () => {
  const session = await SpectreSession.unlock(IDENTITY, 'banana colored duckling')
  const answerSite: Site = { ...SITE, id: 's2', purpose: 'answer', answer: 'question', template: 31 }
  assert.equal(await session.password(answerSite), 'xogx tem cegyiva jab')
  session.destroy()
})

test('login purpose derives the login name without context', async () => {
  const session = await SpectreSession.unlock(IDENTITY, 'banana colored duckling')
  const loginSite: Site = { ...SITE, id: 's3', purpose: 'login', template: 30 }
  assert.equal(await session.password(loginSite), 'wohzaqage')
  session.destroy()
})

test('bumping the counter changes the derived password (same site, same passphrase)', async () => {
  const session = await SpectreSession.unlock(IDENTITY, 'banana colored duckling')
  const v1 = await session.password({ ...SITE, counter: 1 })
  const v2 = await session.password({ ...SITE, counter: 2 })
  const v1Again = await session.password({ ...SITE, counter: 1 })
  assert.notEqual(v1, v2, 'counter must change the derived secret')
  assert.equal(v1Again, v1, 'same counter must be deterministic')
  session.destroy()
})