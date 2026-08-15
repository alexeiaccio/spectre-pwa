import { describe, expect, test } from 'vitest'
import { computeIdenticon } from '../src/lib/spectre/identicon.ts'

describe('computeIdenticon', () => {
  test('matches the reference vector (mpw_identicon)', async () => {
    expect(await computeIdenticon('Test User', 'password')).toEqual({
      glyphs: '╰☻╝♟',
      color: '#e2e8f0',
    })
    expect(
      await computeIdenticon(
        'Alice Wonderland',
        'correct horse battery staple',
      ),
    ).toEqual({
      glyphs: '╰█═⛅',
      color: '#4ade80',
    })
  })

  test('is deterministic for the same inputs', async () => {
    const a = await computeIdenticon('Ada Lovelace', 'first-program')
    const b = await computeIdenticon('Ada Lovelace', 'first-program')
    expect(a).toEqual(b)
  })

  test('changes when the secret changes', async () => {
    const a = await computeIdenticon('Ada Lovelace', 'first-program')
    const b = await computeIdenticon('Ada Lovelace', 'different-secret')
    expect(a.glyphs).not.toBe(b.glyphs)
  })
})
