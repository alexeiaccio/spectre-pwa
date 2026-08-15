import { createSignal, Show } from 'solid-js'
import { Clock, Effect } from 'effect'
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
import {
  adoptHostCode,
  reencryptUnderDekB,
  verifyRecoveryCode,
} from '../lib/sync/records.ts'
import {
  HOST_KEY,
  decodeEnvelopeDoc,
  decodeHostDoc,
  decodeRecordDoc,
  encodeEnvelopeDoc,
  encodeRecordDoc,
  envelopeKey,
  type DeviceEnvelope,
  type SyncRecord,
} from '../lib/sync/types.ts'
import { readDeviceEnvelope, readMeta } from '../lib/vault/storage.ts'
import { vaultImpl } from '../lib/vault/service.ts'
import { createPasskeyWithPrf, getPrfOutput } from '../lib/vault/passkey.ts'

type JoinStep =
  | 'unlock'
  | 'invite'
  | 'syncing'
  | 'recovery'
  | 'enrolling'
  | 'adopting'

/**
 * Poll `fn` until it returns a value, the Effect `Clock` passes the deadline,
 * or the polling interval elapses. Runs on Effect's clock so it is testable and
 * free of raw `Date.now`/`setTimeout` timers.
 */
const waitForValue = (
  fn: () => Promise<string | null>,
  timeoutMs: number,
  intervalMs = 1500,
): Promise<string | null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const end = (yield* Clock.currentTimeMillis) + timeoutMs
      while (true) {
        const v = yield* Effect.tryPromise(fn)
        if (v) return v
        if ((yield* Clock.currentTimeMillis) >= end) return null
        yield* Effect.sleep(intervalMs)
      }
    }),
  )

export default function JoinScreen() {
  const { api, navigate } = useScreen()
  const [step, setStep] = createSignal<JoinStep>('invite')
  const [inviteMode, setInviteMode] = createSignal<'paste' | 'scan' | 'image'>(
    'paste',
  )
  const [ticket, setTicket] = createSignal('')
  const [code, setCode] = createSignal('')
  const [localCode, setLocalCode] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  // A device that already has a vault joins by adopting the host's code.
  const existingVault = (): boolean =>
    api.vault.status().kind === 'locked' ||
    api.vault.status().kind === 'unlocked'

  let sync: SyncAdapter | null = null
  let docId = ''
  let hostEnvelope: DeviceEnvelope | null = null
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
    if (!ticket().trim()) return
    setBusy(true)
    setStep('syncing')
    try {
      const adapter = getSyncAdapter()
      sync = adapter
      await adapter.start()
      const joined = await adapter.joinDoc(ticket().trim())
      await persistDoc(ticket().trim(), joined.docId)
      docId = joined.docId
      // Experimental sync may deliver slowly (or not at all) — poll with a
      // generous window and surface the state rather than hard-failing.
      const hostStr = await waitForValue(
        () => adapter.get(docId, HOST_KEY),
        45_000,
      )
      if (!hostStr)
        throw new SyncUnavailableError({
          message:
            'no data from the host yet — is the other device online and did it share an invitation? (experimental sync)',
        })
      const host = decodeHostDoc(hostStr)
      const envStr = await waitForValue(
        () => adapter.get(docId, envelopeKey(host.deviceId)),
        15_000,
      )
      if (!envStr)
        throw new SyncUnavailableError({
          message: 'host envelope not found (experimental sync)',
        })
      hostEnvelope = decodeEnvelopeDoc(envStr)
      for (const id of host.identityIds) {
        const recStr = await adapter.get(docId, id)
        if (recStr) hostRecords.set(id, decodeRecordDoc(recStr))
      }
      if (hostRecords.size === 0)
        throw new SyncUnavailableError({
          message: 'no identity records from the host yet',
        })
      setStep('recovery')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (): Promise<void> => {
    if (!hostEnvelope) return
    setError(null)
    setBusy(true)
    try {
      const ok = await Effect.runPromise(
        verifyRecoveryCode(hostEnvelope, code()),
      )
      if (!ok) {
        setError('wrong recovery code')
        return
      }
      // A's code verified → fresh installs enroll a new passkey; existing
      // vaults adopt A's code by rotating their DEK under B's own passkey.
      setStep(existingVault() ? 'adopting' : 'enrolling')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const enrollAndFinish = async (): Promise<void> => {
    if (!hostEnvelope || !sync || !docId) return
    setError(null)
    setBusy(true)
    try {
      // Fresh join: enroll this device's passkey so DEK-B gets its wrap too.
      const prfSalt = crypto.getRandomValues(new Uint8Array(32))
      const { credId, prfOutput } = await Effect.runPromise(
        createPasskeyWithPrf(prfSalt),
      )
      const deviceId = crypto.randomUUID()
      const joined = await Effect.runPromise(
        reencryptUnderDekB({
          hostEnvelope,
          hostRecords,
          recoveryCode: code(),
          deviceId,
          passkeyPrf: prfOutput,
          passkeyPrfSalt: prfSalt,
          passkeyCredId: credId,
        }),
      )
      // Write B's records + envelope into the doc (last writer = B).
      for (const [id, rec] of joined.records) {
        await sync.set(docId, id, encodeRecordDoc(rec))
      }
      await sync.set(
        docId,
        envelopeKey(deviceId),
        encodeEnvelopeDoc(joined.envelope),
      )
      // Complete locally: adopt the joined records + envelope under DEK-B.
      const result = await api.vault.importJoined({
        deviceId: joined.envelope.deviceId,
        envelope: { version: 1, deks: joined.envelope.deks },
        records: joined.records,
        dek: joined.dek,
      })
      if (!result) setError('could not save the joined vault')
      else navigate('/') // route to / (identities) — the router takes over
      // On success the vault status becomes unlocked and the router takes over.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const adoptAndFinish = async (): Promise<void> => {
    if (!hostEnvelope || !sync || !docId) return
    setError(null)
    setBusy(true)
    try {
      // Existing-vault join (S5 adopt-the-code): B keeps its identities, adopts
      // A's recovery code, and rotates its DEK under B's own passkey.
      const meta = await Effect.runPromise(readMeta())
      if (!meta?.deviceId)
        throw new SyncUnavailableError({ message: 'no device identity' })
      const localEnvelope = await Effect.runPromise(
        readDeviceEnvelope(meta.deviceId),
      )
      if (!localEnvelope)
        throw new SyncUnavailableError({ message: 'no local envelope' })
      const session = await Effect.runPromise(vaultImpl.session())
      if (!session) throw new SyncUnavailableError({ message: 'vault locked' })
      const passkeyRec = localEnvelope.deks.find((d) => d.method === 'passkey')
      if (!passkeyRec?.prfSalt || !passkeyRec.credId)
        throw new SyncUnavailableError({ message: 'no passkey record' })
      const { prfOutput } = await Effect.runPromise(
        getPrfOutput(new Uint8Array(passkeyRec.prfSalt), passkeyRec.credId),
      )
      const joined = await Effect.runPromise(
        adoptHostCode({
          hostEnvelope,
          hostRecords,
          hostCode: code(),
          localVault: session.vault,
          deviceId: meta.deviceId,
          passkeyPrf: prfOutput,
          passkeyPrfSalt: new Uint8Array(passkeyRec.prfSalt),
          passkeyCredId: passkeyRec.credId,
        }),
      )
      for (const [id, rec] of joined.records) {
        await sync.set(docId, id, encodeRecordDoc(rec))
      }
      await sync.set(
        docId,
        envelopeKey(meta.deviceId),
        encodeEnvelopeDoc(joined.envelope),
      )
      const result = await api.vault.importJoined({
        deviceId: meta.deviceId,
        envelope: { version: 1, deks: joined.envelope.deks },
        records: joined.records,
        dek: joined.dek,
      })
      if (!result) setError('could not save the joined vault')
      else navigate('/') // route to / (identities)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

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
          This device already has a vault — joining adopts the other device's
          recovery code; this vault's identities merge in (your old code stops
          working).
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
            onInput={(e) => setLocalCode((e.target as HTMLInputElement).value)}
            placeholder="recovery code"
            type="password"
            autocomplete="current-password"
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
              setTicket(text)
              void startJoin()
            }}
          />
        </Show>
        <Show when={inviteMode() === 'image'}>
          <QrImagePicker
            onScan={(text) => {
              setTicket(text)
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
              value={ticket()}
              onInput={(e) =>
                setTicket((e.target as HTMLTextAreaElement).value)
              }
              placeholder="invitation string"
            />
            <Button variant="primary" type="submit" disabled={!ticket().trim()}>
              Join
            </Button>
          </form>
        </Show>
      </Show>

      <Show when={step() === 'syncing'}>
        <Accent>
          {busy() ? 'Connecting to the other device…' : 'Waiting for the host…'}
        </Accent>
        <Button variant="primary" onClick={() => void startJoin()}>
          Retry
        </Button>
      </Show>

      <Show when={step() === 'recovery'}>
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submitCode()
          }}
        >
          <Text>
            Enter the recovery code from the other device (verified against the
            host's envelope):
          </Text>
          <Input
            label="Recovery code"
            value={code()}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            placeholder="recovery code"
            type="password"
            autocomplete="current-password"
          />
          <Button variant="primary" type="submit" disabled={code().length < 8}>
            Unlock &amp; join
          </Button>
        </form>
      </Show>

      <Show when={step() === 'enrolling'}>
        <Text>Last step — enroll a passkey for this device:</Text>
        <Button variant="primary" onClick={() => void enrollAndFinish()}>
          {busy() ? 'Enrolling…' : 'Enroll passkey'}
        </Button>
      </Show>

      <Show when={step() === 'adopting'}>
        <Text>
          Last step — confirm this device's passkey; your vault adopts the other
          device's recovery code.
        </Text>
        <Button variant="primary" onClick={() => void adoptAndFinish()}>
          {busy() ? 'Adopting…' : 'Adopt &amp; merge'}
        </Button>
      </Show>
    </div>
  )
}
