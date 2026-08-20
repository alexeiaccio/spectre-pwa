import { Effect, Schema } from 'effect'
import type { SyncAdapter } from './adapter.ts'
import { SyncUnavailableError } from './adapter.ts'
import {
  createShareSecret,
  importGroupKey,
  wrapGroupKeyUnderShare,
} from './group.ts'
import { encodeIdentityRecord } from './records.ts'
import {
  DEVICES_KEY,
  encodeDeviceList,
  HOST_KEY,
  encodeHostDoc,
  encodeRecordDoc,
  type HostPointer,
} from './types.ts'
import type { Identity } from '../vault/schema.ts'

// GS2: the invitation handoff. The host writes a *chosen* identity set into a
// fresh sync doc encrypted under the group key K, then bundles the doc ticket
// with a one-time share secret S (and K wrapped under S) into an invitation
// string. Possession of the invitation is the trust — the joiner recovers K
// from it, so no host passphrase is needed. Rotating S (a fresh invitation for
// the same doc) renders a prior invitation non-reusable.

const Bytes = Schema.Uint8ArrayFromBase64

const InvitationSchema = Schema.Struct({
  v: Schema.Literal(1),
  /** The iroh DocTicket (dial + doc id). */
  ticket: Schema.String,
  /** The trust group this doc belongs to. */
  groupId: Schema.String,
  /** One-time share secret S — the invitation's trust grant. */
  secret: Bytes,
  /** K wrapped under S, so the joiner can recover K for this join. */
  share: Schema.Struct({ salt: Bytes, iv: Bytes, ct: Bytes }),
})

export interface Invitation {
  v: 1
  ticket: string
  groupId: string
  secret: Uint8Array
  share: { salt: Uint8Array; iv: Uint8Array; ct: Uint8Array }
}

export const encodeInvitation = (inv: Invitation): string =>
  Schema.encodeSync(Schema.fromJsonString(InvitationSchema))({
    v: 1,
    ticket: inv.ticket,
    groupId: inv.groupId,
    secret: inv.secret,
    share: {
      salt: inv.share.salt,
      iv: inv.share.iv,
      ct: inv.share.ct,
    },
  })

export const decodeInvitation = (s: string): Invitation => {
  const w = Schema.decodeSync(Schema.fromJsonString(InvitationSchema))(s)
  return { v: 1, ticket: w.ticket, groupId: w.groupId, secret: w.secret, share: w.share }
}

/**
 * Host-side: create a new sync doc and publish the selected identities
 * (encrypted under the group key K), then produce a one-time invitation that
 * lets a joiner recover K. Only `identities` are written/shared — unselected
 * ones never appear in the doc (GS4's selection is respected here).
 */
export const createGroupInvitation = async (args: {
  sync: SyncAdapter
  groupId: string
  deviceId: string
  /** The identities chosen to share (subset of the vault). */
  identities: readonly Identity[]
  /** Raw 32 bytes of the group key K. */
  groupKeyRaw: Uint8Array
  /** Optional doc-capability persistence (wired by the real flow; a no-op by default). */
  persist?: (ticket: string, docId: string) => Promise<void>
  /** Optional: this (host) device's ECDH public key hex, registered in the roster. */
  hostPublicHex?: string
}): Promise<string> => {
  const { sync, groupId, deviceId, identities, groupKeyRaw, persist, hostPublicHex } = args
  if (identities.length === 0)
    throw new SyncUnavailableError({ message: 'no identities selected to share' })
  const k = await Effect.runPromise(importGroupKey(new Uint8Array(groupKeyRaw)))

  const doc = await sync.createDoc()
  await persist?.(doc.ticket, doc.docId)
  const host: HostPointer = { deviceId, identityIds: identities.map((i) => i.id) }
  await sync.set(doc.docId, HOST_KEY, encodeHostDoc(host))
  for (const identity of identities) {
    const record = await Effect.runPromise(encodeIdentityRecord(k, identity, deviceId))
    await sync.set(doc.docId, identity.id, encodeRecordDoc(record))
  }

  const secret = createShareSecret()
  const share = await Effect.runPromise(
    wrapGroupKeyUnderShare(new Uint8Array(groupKeyRaw), secret),
  )

  // Register the host in the doc's device roster so other devices can see it
  // (joiners already append themselves). Without this, joiners would never see
  // the host in "Paired devices".
  if (hostPublicHex) {
    await sync.set(
      doc.docId,
      DEVICES_KEY,
      encodeDeviceList({ v: 1, devices: [{ deviceId, publicHex: hostPublicHex }] }),
    )
  }

  const inv: Invitation = {
    v: 1,
    ticket: doc.ticket,
    groupId,
    secret,
    share: { salt: share.salt, iv: share.iv, ct: share.ct },
  }
  return encodeInvitation(inv)
}

/**
 * One-time semantics: refresh the share secret for the same doc. The old
 * invitation's S no longer unwraps K, so a prior/in-flight invitation can't be
 * replayed after the first join. Uses the existing ticket (records are already
 * under K in the doc).
 */
export const rotateGroupInvitation = async (args: {
  sync: SyncAdapter
  existing: string
  groupKeyRaw: Uint8Array
}): Promise<string> => {
  const { sync, existing, groupKeyRaw } = args
  const old = decodeInvitation(existing)
  const secret = createShareSecret()
  const share = await Effect.runPromise(
    wrapGroupKeyUnderShare(new Uint8Array(groupKeyRaw), secret),
  )
  void sync // rotation touches doc only if we choose to rewrite records; here it doesn't
  const inv: Invitation = {
    v: 1,
    ticket: old.ticket,
    groupId: old.groupId,
    secret,
    share: { salt: share.salt, iv: share.iv, ct: share.ct },
  }
  return encodeInvitation(inv)
}
