import { expect, test } from 'vitest'
import {
  addSite,
  updateSite,
  deleteSite,
  deleteIdentity,
} from '../src/lib/vault/mutations.ts'
import type { Identity, Site, Vault } from '../src/lib/vault/schema.ts'

const VAULT: Vault = {
  formatVersion: 1,
  identities: [
    {
      id: 'i1',
      fullName: 'Alice',
      algorithm: 3,
      sites: [
        {
          id: 's1',
          name: 'a.com',
          counter: 1,
          template: 17,
          purpose: 'password',
        },
        {
          id: 's2',
          name: 'b.com',
          counter: 3,
          template: 18,
          purpose: 'password',
        },
      ],
    },
    { id: 'i2', fullName: 'Bob', algorithm: 3, sites: [] },
  ],
}

const NEW_SITE: Site = {
  id: 's3',
  name: 'c.com',
  counter: 2,
  template: 30,
  purpose: 'login',
}

const siteNames = (vault: Vault, identityId: string): string[] =>
  (vault.identities.find((i) => i.id === identityId) as Identity).sites.map(
    (s) => s.name,
  )

test('addSite appends the site and never mutates the input vault', () => {
  const next = addSite(VAULT, 'i1', NEW_SITE)
  expect(siteNames(next, 'i1')).toEqual(['a.com', 'b.com', 'c.com'])
  expect(next.identities[0].sites.length).toBe(3)
  expect(VAULT.identities[0].sites.length).toBe(2)
})

test('addSite is a no-op for a missing identity', () => {
  const next = addSite(VAULT, 'nope', NEW_SITE)
  expect(next).toEqual(VAULT)
})

test('updateSite replaces the matching site in place, preserving identity order', () => {
  const updated: Site = { ...VAULT.identities[0].sites[0], counter: 5 }
  const next = updateSite(VAULT, 'i1', updated)
  expect(next.identities[0].sites[0].counter).toBe(5)
  expect(siteNames(next, 'i1')).toEqual(['a.com', 'b.com'])
  expect(VAULT.identities[0].sites[0].counter).toBe(1)
})

test('updateSite is a no-op when the site id is unknown', () => {
  const next = updateSite(VAULT, 'i1', { ...NEW_SITE, id: 'ghost' })
  expect(next).toEqual(VAULT)
})

test('deleteSite removes only the targeted site', () => {
  const next = deleteSite(VAULT, 'i1', 's1')
  expect(siteNames(next, 'i1')).toEqual(['b.com'])
  expect(VAULT.identities[0].sites.length).toBe(2)
})

test('deleteSite is a no-op for an unknown site', () => {
  const next = deleteSite(VAULT, 'i1', 'ghost')
  expect(next).toEqual(VAULT)
})

test('deleteIdentity removes the identity and leaves others alone', () => {
  const next = deleteIdentity(VAULT, 'i1')
  expect(next.identities.map((i) => i.id)).toEqual(['i2'])
})

test('deleteIdentity is a no-op for an unknown identity', () => {
  const next = deleteIdentity(VAULT, 'ghost')
  expect(next).toEqual(VAULT)
})
