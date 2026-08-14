import { expect, test } from 'vitest'
import {
  newUserKey,
  newSiteKey,
  renderSiteKey,
} from '../src/lib/spectre/spectre-algorithm.ts'

const NAME = 'Robert Lee Mitchell'
const SECRET = 'banana colored duckling'
const SITE = 'masterpasswordapp.com'

async function pw(
  version: number,
  site = SITE,
  counter = 1,
  purpose = 'authentication' as const,
  context: string | null = null,
  type = 17,
) {
  const userKey = await newUserKey(NAME, SECRET, version as never)
  const siteKey = await newSiteKey(userKey, site, counter, purpose, context)
  return renderSiteKey(siteKey.key, siteKey.version, type)
}

test('bit-identical to Master Password V3 (official vector)', async () => {
  expect(await pw(3)).toBe('Jejr5[RepuSosp')
})

test('V0 host-endian quirk', async () => {
  expect(await pw(0)).toBe('Feji5@ReduWosh')
})

test('result types (V3)', async () => {
  expect(await pw(3, SITE, 1, 'authentication', null, 16)).toBe(
    'W6@692^B1#&@gVdSdLZ@',
  )
  expect(await pw(3, SITE, 1, 'authentication', null, 18)).toBe('Jej2$Quv')
  expect(await pw(3, SITE, 1, 'authentication', null, 20)).toBe('WAo2xIg6')
  expect(await pw(3, SITE, 1, 'authentication', null, 19)).toBe('Jej2')
  expect(await pw(3, SITE, 1, 'authentication', null, 21)).toBe('7662')
})

test('purpose scoping', async () => {
  expect(await pw(3, SITE, 1, 'identification', null, 30)).toBe('wohzaqage')
  expect(await pw(3, SITE, 1, 'recovery', null, 31)).toBe('xin diyjiqoja hubu')
  expect(await pw(3, SITE, 1, 'recovery', 'question', 31)).toBe(
    'xogx tem cegyiva jab',
  )
})

test('counter ceiling', async () => {
  expect(await pw(3, SITE, 4294967295)).toBe('XambHoqo6[Peni')
  expect(await pw(0, SITE, 4294967295)).toBe('QateDojh1@Hecn')
})

test('multibyte length rules pin the encoding logic', async () => {
  expect(await pw(0, '⛄')).toBe('HahiVana2@Nole')
  expect(await pw(1, '⛄')).toBe('WawiYarp2@Kodh')
  expect(await pw(2, '⛄')).toBe('LiheCuwhSerz6)')
  expect(await pw(3, '⛄')).toBe('LiheCuwhSerz6)')
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
    expect(renderSiteKey(siteKey.key, siteKey.version, 17)).toBe(expected)
  }
})
