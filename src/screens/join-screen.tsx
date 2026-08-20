import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { Effect } from 'effect'
import { useScreen } from '../lib/flow.ts'
import {
  Accent,
  Button,
  ErrorText,
  Hint,
  Input,
  QrImagePicker,
  QrScanner,
  Text,
  Textarea,
} from '../components/ui/index.ts'
import {
  SYNC_EXPERIMENTAL,
  SyncUnavailableError,
  getSyncAdapter,
  persistDoc,
} from '../lib/sync/adapter.ts'
import type { SyncAdapter } from '../lib/sync/adapter.ts'
import { decodeInvitation } from '../lib/sync/invitation.ts'
import {
  consentGroupJoin,
  encodeIdentityRecord,
} from '../lib/sync/records.ts'
import {
  DEVICES_KEY,
  HOST_KEY,
  decodeDeviceList,
  decodeHostDoc,
  decodeRecordDoc,
  encodeDeviceList,
  encodeGroupEnvelope,
  encodeRecordDoc,
  envelopeKey,
  type SyncRecord,
} from '../lib/sync/types.ts'
import { createPasskeyWithPrf, isPrfUnavailable } from '../lib/vault/passkey.ts'
import type { Identity } from '../lib/vault/schema.ts'

type JoinStep = 'unlock' | 'invite' | 'syncing' | 'setkey'

const toHex = (u: Uint8Array): string =>
  [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

export default function JoinScreen() {
  const { api, navigate } = useScreen()
  const [step, setStep] = createSignal<JoinStep>('invite')
  const [inviteMode, setInviteMode] = createSignal<'paste' | 'scan' | 'image'>(
    'paste',
  )
  const [invitation, setInvitation] = createSignal('')
  const [localCode, setLocalCode] = createSignal('')
  // The joiner's OWN per-device passphrase (never the host's).
  const [passphrase, setPassphrase] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [diag, setDiag] = createSignal<string[]>([])

  // A device that already has its own vault unlocks it locally first; its
  // identities merge into the group (union) on join (GS3).
  const existingVault = (): boolean =>
    api.vault.status().kind === 'locked' ||
    api.vault.status().kind === 'unlocked'

  let sync: SyncAdapter | null = null
  let docId = ''
  let hostRecords = new Map<string, SyncRecord>()

  const unlockLocal = async (
    method: { kind: 'passkey' } | { kind: 'recovery'; code: string },
  ): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const ok =
        method.kind === 'passkey'
          ? await api.vault.unlock().then((v) => v !== undefined)
          : await api.vault
              .unlockWithRecovery(method.code)
              .then((v) => v !== undefined)
      if (ok) setStep('invite')
      else setError('could not unlock this device')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startJoin = async (): Promise<void> => {
    setError(null)
    setDiag([])
    if (!invitation().trim()) return
    setBusy(true)
    setStep('syncing')
    try {
      // The invitation now carries the doc ticket + the one-time share secret.
      const inv = decodeInvitation(invitation().trim())
      const adapter = getSyncAdapter()
      sync = adapter
      try {
        await adapter.start()
      } catch (e) {
        throw new SyncUnavailableError({
          message: `could not start the sync engine: ${e instanceof Error ? e.message : String(e)}`,
        })
      }
      let joined: { docId: string }
      try {
        joined = await adapter.joinDoc(inv.ticket)
      } catch (e) {
        throw new SyncUnavailableError({
          message: `could not join the sync doc — is the relay reachable? (${e instanceof Error ? e.message : String(e)})`,
        })
      }
      await persistDoc(inv.ticket, joined.docId)
      docId = joined.docId
      // Experimental sync can deliver slowly or not at all — poll, and track
      // whether the host peer ever connects so the error tells us which.
      const sleep = (ms: number): Promise<void> =>
        new Promise((r) => window.setTimeout(r, ms))
      const deadline = Date.now() + 60_000
      let hostStr: string | null = null
      let lastPeers = ''
      let probed = false
      while (Date.now() < deadline && !hostStr) {
        hostStr = await adapter.get(docId, HOST_KEY)
        if (hostStr) break
        try {
          lastPeers = await adapter.syncPeers(docId)
        } catch {
          lastPeers = ''
        }
        if (lastPeers && !probed) {
          // Peer connected but the host's pre-existing HOST_KEY hasn't been
          // pulled yet. Nudge a sync round with a harmless probe write — a
          // fresh insert often triggers the engine to exchange the host's
          // existing entries (this is the documented-good path). Others ignore
          // `probe/` keys.
          try {
            await adapter.set(
              docId,
              `probe/${crypto.randomUUID()}`,
              'join-probe',
            )
          } catch {
            // best-effort nudge
          }
          probed = true
        }
        await sleep(lastPeers ? 1500 : 2000)
      }
      if (!hostStr)
        throw new SyncUnavailableError({
          message: lastPeers
            ? `host pointer not received within 60s (peer connected: ${lastPeers.slice(0, 12)}…) — retry`
            : 'no data from the host — the peer never connected. Is the other device online and did it stay on the invitation screen?',
        })
      const host = decodeHostDoc(hostStr)
      for (const id of host.identityIds) {
        const recStr = await adapter.get(docId, id)
        if (recStr) hostRecords.set(id, decodeRecordDoc(recStr))
      }
      if (hostRecords.size === 0)
        throw new SyncUnavailableError({
          message: 'no identity records from the host yet',
        })
      setStep('setkey')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Finish the join: enter a per-device passphrase (own, not the host's),
  // recover the group key from the invitation, adopt/merge the identities.
  const finish = async (): Promise<void> => {
    if (!sync || !docId || !invitation().trim()) return
    setError(null)
    setBusy(true)
    try {
      const inv = decodeInvitation(invitation().trim())
      let passkey: { prf?: Uint8Array; prfSalt?: Uint8Array; credId?: string } =
        {}
      const prfSalt = crypto.getRandomValues(new Uint8Array(32))
      try {
        const { credId, prfOutput } = await Effect.runPromise(
          createPasskeyWithPrf(prfSalt),
        )
        passkey = { prf: prfOutput, prfSalt, credId }
      } catch (e) {
        // No PRF-capable authenticator — the per-device passphrase suffices
        // (wraps K under the recovery method alone).
        if (!isPrfUnavailable(e)) throw e
      }
      const deviceId = crypto.randomUUID()

      const consent = await Effect.runPromise(
        consentGroupJoin({
          invitation: inv,
          hostRecords,
          deviceId,
          passphrase: passphrase(),
          passkeyPrf: passkey.prf,
          passkeyPrfSalt: passkey.prfSalt,
          passkeyCredId: passkey.credId,
        }),
      )

      // Merge: an existing vault keeps its local identities (re-encrypted under
      // K) and adopts the group's; a fresh join takes the offered identities.
      const merged = new Map<string, Identity>()
      if (existingVault()) {
        const cur = api.vault.status()
        if (cur.kind === 'unlocked') {
          for (const i of cur.vault.identities) merged.set(i.id, i)
        }
      }
      for (const i of consent.identities) {
        if (!merged.has(i.id)) merged.set(i.id, i)
      }

      // Records the group shares: offered ones (already under K) + this
      // device's local identities (re-encrypted under K).
      const records = new Map(consent.records)
      for (const [id, identity] of merged) {
        const rec = await Effect.runPromise(
          encodeIdentityRecord(consent.groupKey, identity, deviceId),
        )
        records.set(id, rec)
      }
      // Publish this device's group envelope + records so the group sees it.
      await sync.set(
        docId,
        envelopeKey(deviceId),
        encodeGroupEnvelope(consent.envelope),
      )
      for (const [id, rec] of records) {
        await sync.set(docId, id, encodeRecordDoc(rec))
      }

      // Appends this device to the group roster (GS6 enumeration/rotation targets).
      const rosterStr = await sync.get(docId, DEVICES_KEY)
      const roster = rosterStr
        ? decodeDeviceList(rosterStr)
        : { v: 1, devices: [] }
      if (!roster.devices.some((d) => d.deviceId === deviceId)) {
        await sync.set(
          docId,
          DEVICES_KEY,
          encodeDeviceList({
            v: 1,
            devices: [
              ...roster.devices,
              {
                deviceId,
                publicHex: toHex(new Uint8Array(consent.envelope.devicePublic)),
              },
            ],
          }),
        )
      }

      // Complete locally: adopt the group envelope + records + K + device key.
      const result = await api.vault.importJoined({
        deviceId,
        envelope: {
          version: 2,
          deks: consent.envelope.deks,
          groupId: consent.envelope.groupId,
          devicePublic: consent.envelope.devicePublic,
          deviceSecret: consent.envelope.deviceSecret,
        },
        records,
        dek: consent.groupKey,
        devicePrivatePkcs8: consent.devicePrivatePkcs8,
      })
      if (!result) setError('could not save the joined vault')
      else navigate('/settings')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Poll iroh connection diagnostics (spike-style) while on the invite or
  // syncing step: relay / node / doc sync / peers.
  createEffect(
    () => step() === 'invite' || step() === 'syncing',
    (active) => {
      if (!active) {
        setDiag([])
        return
      }
      void getSyncAdapter().start().catch(() => {})
      const timer = window.setInterval(() => {
        const s = sync
        if (!s) return
        void (async () => {
          try {
            const lines: string[] = []
            lines.push(`relay: ${await s.relayStatus()}`)
            lines.push(`node: ${await s.nodeId()}`)
            if (docId) {
              lines.push(`sync: ${await s.syncStatus(docId)}`)
              lines.push(`peers: ${await s.syncPeers(docId)}`)
            }
            setDiag(lines)
          } catch {
            // wasm busy — skip this tick
          }
        })()
      }, 2000)
      onCleanup(() => window.clearInterval(timer))
    },
  )

  return (
    <div data-screen="join" class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <p class="text-lg font-medium text-slate-100">Join a vault</p>
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          onClick={() => navigate('/')}
        >
          ← back
        </button>
      </div>

      <Show when={api.vault.status().kind === 'locked'}>
        <Hint>
          This device has its own vault — joining keeps your identities and
          merges in the shared ones (your device's unlock stays yours).
        </Hint>
      </Show>
      <Show when={SYNC_EXPERIMENTAL}>
        <Hint>
          Browser sync is experimental (upstream iroh-docs wasm); the other
          device must stay online. If nothing arrives, retry.
        </Hint>
      </Show>
      <Show when={error()}>
        <ErrorText>{error()}</ErrorText>
      </Show>

      <Show when={step() === 'unlock'}>
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void unlockLocal({ kind: 'recovery', code: localCode() })
          }}
        >
          <Text>
            Unlock this device first (its identities will merge into the joined
            vault):
          </Text>
          <Button
            variant="primary"
            type="button"
            onClick={() => void unlockLocal({ kind: 'passkey' })}
          >
            Unlock with passkey
          </Button>
          <Input
            label="Recovery code"
            value={localCode()}
            onInput={(e) => setLocalCode(e.currentTarget.value)}
            placeholder="recovery code"
            type="password"
            autocomplete="current-password"
            revealable
          />
          <Button
            variant="secondary"
            type="submit"
            disabled={localCode().length < 8}
          >
            Unlock with code
          </Button>
        </form>
      </Show>

      <Show when={step() === 'invite'}>
        <Text>
          Enter the invitation from your other device (created under “Sync with
          another device”):
        </Text>
        <div class="flex gap-2">
          <button
            class={
              inviteMode() === 'paste'
                ? 'rounded border border-teal-spectre px-3 py-1 text-xs text-teal-spectre'
                : 'rounded border border-surface-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200'
            }
            onClick={() => setInviteMode('paste')}
          >
            Paste
          </button>
          <button
            class={
              inviteMode() === 'scan'
                ? 'rounded border border-teal-spectre px-3 py-1 text-xs text-teal-spectre'
                : 'rounded border border-surface-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200'
            }
            onClick={() => setInviteMode('scan')}
          >
            Scan QR
          </button>
          <button
            class={
              inviteMode() === 'image'
                ? 'rounded border border-teal-spectre px-3 py-1 text-xs text-teal-spectre'
                : 'rounded border border-surface-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200'
            }
            onClick={() => setInviteMode('image')}
          >
            Pick image
          </button>
        </div>
        <Show when={inviteMode() === 'scan'}>
          <QrScanner
            onScan={(text) => {
              setInvitation(text)
              void startJoin()
            }}
          />
        </Show>
        <Show when={inviteMode() === 'image'}>
          <QrImagePicker
            onScan={(text) => {
              setInvitation(text)
              void startJoin()
            }}
          />
        </Show>
        <Show when={inviteMode() === 'paste'}>
          <form
            class="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void startJoin()
            }}
          >
            <Textarea
              label="Invitation string"
              value={invitation()}
              onInput={(e) => setInvitation(e.currentTarget.value)}
              placeholder="invitation string"
            />
            <Button
              variant="primary"
              type="submit"
              disabled={!invitation().trim()}
            >
              Join
            </Button>
          </form>
        </Show>
        <Show when={diag().length}>
          <pre class="rounded border border-surface-700 bg-surface-800 p-2 text-xs text-slate-400">
            {diag().join('\n')}
          </pre>
        </Show>
      </Show>

      <Show when={step() === 'syncing'}>
        <Accent>
          {busy() ? 'Connecting to the other device…' : 'Waiting for the host…'}
        </Accent>
        <Show when={diag().length}>
          <pre class="rounded border border-surface-700 bg-surface-800 p-2 text-xs text-slate-400">
            {diag().join('\n')}
          </pre>
        </Show>
        <Button variant="primary" onClick={() => void startJoin()}>
          Retry
        </Button>
      </Show>

      <Show when={step() === 'setkey'}>
        <Text>
          The host shared {hostRecords.size}{' '}
          identity{hostRecords.size === 1 ? '' : 'ies'} with you. Set a
          passphrase for THIS device to protect your copy:
        </Text>
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void finish()
          }}
        >
          <Input
            label="This device's passphrase"
            value={passphrase()}
            onInput={(e) => setPassphrase(e.currentTarget.value)}
            placeholder="a passphrase only this device uses"
            type="password"
            autocomplete="new-password"
            revealable
          />
          <Button
            variant="primary"
            type="submit"
            disabled={passphrase().length < 8 || busy()}
          >
            {busy() ? 'Joining…' : 'Finish joining'}
          </Button>
        </form>
      </Show>
    </div>
  )
}
