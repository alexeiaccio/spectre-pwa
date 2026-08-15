import { Effect } from 'effect'
import { vaultImpl } from '../vault/service.ts'
import { readDeviceEnvelope, readMeta } from '../vault/storage.ts'
import { encodeIdentityRecord } from './records.ts'
import {
  ENVELOPE_KEY_PREFIX,
  HOST_KEY,
  encodeEnvelopeDoc,
  encodeHostDoc,
  encodeRecordDoc,
  type HostPointer,
} from './types.ts'
import { SyncUnavailableError, persistDoc } from './adapter.ts'
import type { SyncAdapter } from './adapter.ts'

/**
 * Device A starts the pair (S5): create the sync doc, publish the host pointer
 * (device id + identity ids — the doc has no key-list API), A's envelope, and
 * each identity record encrypted under A's session DEK. Returns the invitation
 * string (the DocTicket) to show as QR / copy.
 */
export const shareVaultDoc = async (sync: SyncAdapter): Promise<string> => {
  const session = await Effect.runPromise(vaultImpl.session())
  if (!session) throw new SyncUnavailableError({ message: 'vault locked' })
  const meta = await Effect.runPromise(readMeta())
  if (!meta?.deviceId)
    throw new SyncUnavailableError({ message: 'vault locked' })
  const envelope = await Effect.runPromise(readDeviceEnvelope(meta.deviceId))
  if (!envelope)
    throw new SyncUnavailableError({
      message: 'no local envelope — run setup first',
    })
  if (session.vault.identities.length === 0)
    throw new SyncUnavailableError({ message: 'no identities to share yet' })

  const deviceId = meta.deviceId
  const doc = await sync.createDoc()
  await persistDoc(doc.ticket, doc.docId)
  const host: HostPointer = {
    deviceId,
    identityIds: session.vault.identities.map((i) => i.id),
  }
  await sync.set(doc.docId, HOST_KEY, encodeHostDoc(host))
  await sync.set(
    doc.docId,
    `${ENVELOPE_KEY_PREFIX}${deviceId}`,
    encodeEnvelopeDoc({ v: 1, deviceId, deks: envelope.deks }),
  )
  for (const identity of session.vault.identities) {
    const record = await Effect.runPromise(
      encodeIdentityRecord(session.dek, identity, deviceId),
    )
    await sync.set(doc.docId, identity.id, encodeRecordDoc(record))
  }
  return doc.ticket
}
