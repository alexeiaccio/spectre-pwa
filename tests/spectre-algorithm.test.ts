import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newUserKey, newSiteKey, renderSiteKey } from '../src/lib/spectre/spectre-algorithm.ts'

const NAME = 'Robert Lee Mitchell'
const SECRET = 'banana colored duckling'
const SITE = 'masterpasswordapp.com'

async function pw(version: number, site = SITE, counter = 1, purpose = 'authentication' as const, context: string | null = null, type = 17) {
  const userKey = await newUserKey(NAME, SECRET, version as never)
  const siteKey = await newSiteKey(userKey, site, counter, purpose, context)
  return renderSiteKey(siteKey.key, siteKey.version, type)
}

test('bit-identical to Master Password V3 (official vector)', async () => {
  assert.equal(await pw(3), 'Jejr5[RepuSosp')
})

test('V0 host-endian quirk', async () => {
  assert.equal(await pw(0), 'Feji5@ReduWosh')
})

test('result types (V3)', async () => {
  assert.equal(await pw(3, SITE, 1, 'authentication', null, 16), 'W6@692^B1#&@gVdSdLZ@')
  assert.equal(await pw(3, SITE, 1, 'authentication', null, 18), 'Jej2$Quv')
  assert.equal(await pw(3, SITE, 1, 'authentication', null, 20), 'WAo2xIg6')
  assert.equal(await pw(3, SITE, 1, 'authentication', null, 19), 'Jej2')
  assert.equal(await pw(3, SITE, 1, 'authentication', null, 21), '7662')
})

test('purpose scoping', async () => {
  assert.equal(await pw(3, SITE, 1, 'identification', null, 30), 'wohzaqage')
  assert.equal(await pw(3, SITE, 1, 'recovery', null, 31), 'xin diyjiqoja hubu')
  assert.equal(await pw(3, SITE, 1, 'recovery', 'question', 31), 'xogx tem cegyiva jab')
})

test('counter ceiling', async () => {
  assert.equal(await pw(3, SITE, 4294967295), 'XambHoqo6[Peni')
  assert.equal(await pw(0, SITE, 4294967295), 'QateDojh1@Hecn')
})

test('multibyte length rules pin the encoding logic', async () => {
  assert.equal(await pw(0, '⛄'), 'HahiVana2@Nole')
  assert.equal(await pw(1, '⛄'), 'WawiYarp2@Kodh')
  assert.equal(await pw(2, '⛄'), 'LiheCuwhSerz6)')
  assert.equal(await pw(3, '⛄'), 'LiheCuwhSerz6)')
})

test('multibyte fullName cases', async () => {
  const cases: [number, string][] = [
    [0, 'HajrYudo7@Mamh'],
    [1, 'WaqoGuho2[Xaxw'],
    [3, 'NopaDajh8=Fene'],
  ]
  for (const [version, expected] of cases) {
    const userKey = await newUserKey('⛄', SECRET, version as never)
    const siteKey = await newSiteKey(userKey, SITE, 1, 'authentication', null)
    assert.equal(renderSiteKey(siteKey.key, siteKey.version, 17), expected)
  }
})