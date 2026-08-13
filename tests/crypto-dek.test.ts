import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Effect } from 'effect'
import { generateDek, kekFromPrf, wrapDek, unwrapDek, encryptBlob, decryptBlob } from '../src/lib/vault/crypto-dek.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

test('DEK wrap/unwrap + encrypt/decrypt roundtrip', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { key: dek, raw } = await run(generateDek())
  const kek = await run(kekFromPrf(secret, salt))
  const { iv, wrapped } = await run(wrapDek(raw, kek))
  raw.fill(0)
  const dek2 = await run(unwrapDek(wrapped, kek, iv))

  const plaintext = new TextEncoder().encode('hello vault')
  const { iv: iv2, ct } = await run(encryptBlob(dek, plaintext))
  const pt = await run(decryptBlob(dek2, iv2, ct))
  assert.equal(new TextDecoder().decode(pt), 'hello vault')
})

test('KEK derivation is deterministic for the same secret+salt', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { raw } = await run(generateDek())
  const kek = await run(kekFromPrf(secret, salt))
  const { iv, wrapped } = await run(wrapDek(raw, kek))
  const kek2 = await run(kekFromPrf(secret, salt))
  const d = await run(unwrapDek(wrapped, kek2, iv))
  const { iv: iv2, ct } = await run(encryptBlob(d, new TextEncoder().encode('data')))
  const pt = await run(decryptBlob(d, iv2, ct))
  assert.equal(new TextDecoder().decode(pt), 'data')
})

test('wrong secret fails to unwrap (AES-GCM auth tag)', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { raw } = await run(generateDek())
  const kek = await run(kekFromPrf(secret, salt))
  const { iv, wrapped } = await run(wrapDek(raw, kek))
  const wrong = crypto.getRandomValues(new Uint8Array(32))
  const kekWrong = await run(kekFromPrf(wrong, salt))
  const bad = await Effect.runPromiseExit(unwrapDek(wrapped, kekWrong, iv))
  assert.equal(bad._tag, 'Failure')
})

test('tampered ciphertext fails to decrypt', async () => {
  const { key: dek, raw } = await run(generateDek())
  const kek = await run(kekFromPrf(new Uint8Array(32), new Uint8Array(16)))
  const { wrapped } = await run(wrapDek(raw, kek))
  const { iv, ct } = await run(encryptBlob(dek, new TextEncoder().encode('data')))
  const tampered = ct.map((b) => b ^ 0xff)
  const bad = await Effect.runPromiseExit(decryptBlob(dek, iv, tampered))
  assert.equal(bad._tag, 'Failure')
  void wrapped
})