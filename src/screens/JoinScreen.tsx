import { createSignal, Show } from 'solid-js'
import { Clock, Effect } from 'effect'
import {
  Input as TextFieldInput,
  Root as TextFieldRoot,
} from '@kobalte/core/text-field'
import {
  SYNC_EXPERIMENTAL,
  SyncUnavailableError,
  getSyncAdapter,
} from '../lib/sync/adapter.ts'
import type { SyncAdapter } from '../lib/sync/adapter.ts'
import { reencryptUnderDekB, verifyRecoveryCode } from '../lib/sync/records.ts'
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
import { createPasskeyWithPrf } from '../lib/vault/passkey.ts'
import type { AesKey } from '../lib/vault/crypto-dek.ts'
import type { Envelope, Vault } from '../lib/vault/schema.ts'
import type { VaultStatus } from '../lib/vault/useVault.ts'

type JoinStep = 'invite' | 'syncing' | 'recovery' | 'enrolling'

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

export default function JoinScreen(props: {
  vaultStatus: () => VaultStatus
  onComplete: (joined: {
    deviceId: string
    envelope: Envelope
    records: Map<string, SyncRecord>
    dek: AesKey
  }) => Promise<Vault | undefined>
  onBack: () => void
}) {
  const [step, setStep] = createSignal<JoinStep>('invite')
  const [ticket, setTicket] = createSignal('')
  const [code, setCode] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  let sync: SyncAdapter | null = null
  let docId = ''
  let hostEnvelope: DeviceEnvelope | null = null
  let hostRecords = new Map<string, SyncRecord>()

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
      setStep('enrolling')
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
      // Enroll this device's passkey first so DEK-B gets its wrap too. The PRF
      // salt + credential id are recorded on the wrap so this device can unlock
      // by passkey later (and target the right credential after re-enrolls).
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
      const result = await props.onComplete({
        deviceId: joined.envelope.deviceId,
        envelope: { version: 1, deks: joined.envelope.deks },
        records: joined.records,
        dek: joined.dek,
      })
      if (!result) setError('could not save the joined vault')
      // On success the vault status becomes unlocked and the router takes over.
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
          onClick={() => props.onBack()}
        >
          ← back
        </button>
      </div>

      <Show when={props.vaultStatus().kind === 'locked'}>
        <p class="text-xs text-amber-400">
          This device already has a vault — joining creates a fresh vault here
          and replaces it.
        </p>
      </Show>
      <Show when={SYNC_EXPERIMENTAL}>
        <p class="text-xs text-slate-500">
          Browser sync is experimental (upstream iroh-docs wasm); the other
          device must stay online. If nothing arrives, retry.
        </p>
      </Show>
      <Show when={error()}>
        <p class="text-sm text-red-400">{error()}</p>
      </Show>

      <Show when={step() === 'invite'}>
        <p class="text-sm text-slate-400">
          Paste the invitation from your other device (created under “Sync with
          another device”):
        </p>
        <textarea
          class="min-h-24 tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={ticket()}
          onInput={(e) => setTicket((e.target as HTMLTextAreaElement).value)}
          placeholder="invitation string"
        />
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={!ticket().trim()}
          onClick={() => void startJoin()}
        >
          Join
        </button>
      </Show>

      <Show when={step() === 'syncing'}>
        <p class="text-sm text-teal-spectre">
          {busy() ? 'Connecting to the other device…' : 'Waiting for the host…'}
        </p>
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black"
          onClick={() => void startJoin()}
        >
          Retry
        </button>
      </Show>

      <Show when={step() === 'recovery'}>
        <p class="text-sm text-slate-400">
          This vault is passphrase-locked. Enter the recovery code from the
          other device (verified against the host's envelope):
        </p>
        <TextFieldRoot>
          <TextFieldInput
            class="tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            value={code()}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            placeholder="recovery code"
            type="password"
          />
        </TextFieldRoot>
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={code().length < 8}
          onClick={() => void submitCode()}
        >
          Unlock &amp; join
        </button>
      </Show>

      <Show when={step() === 'enrolling'}>
        <p class="text-sm text-slate-400">
          Last step — enroll a passkey for this device:
        </p>
        <button
          class="tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black"
          onClick={() => void enrollAndFinish()}
        >
          {busy() ? 'Enrolling…' : 'Enroll passkey'}
        </button>
      </Show>
    </div>
  )
}
