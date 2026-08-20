import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { Effect } from 'effect'
import {
  Button,
  Card,
  Hint,
  Input,
  QrCode,
  Select,
} from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'
import { getSyncAdapter, persistDoc, reopenPersistedDoc } from '../lib/sync/adapter.ts'
import { createGroupInvitation } from '../lib/sync/invitation.ts'
import type { Identity } from '../lib/vault/schema.ts'
import { readMeta, readNodeIdentity } from '../lib/vault/storage.ts'
import { vaultImpl } from '../lib/vault/service.ts'
import {
  DEVICES_KEY,
  decodeDeviceList,
  decodeGroupEnvelope,
  encodeDeviceList,
  encodeGroupEnvelope,
  encodeRecordDoc,
  encodeRekeyDoc,
  envelopeKey,
  rekeyKey,
  type GroupDevice,
  type GroupEnvelope,
} from '../lib/sync/types.ts'

interface AutoLockOption {
  value: number
  label: string
}

const AUTO_LOCK_OPTIONS: AutoLockOption[] = [
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
]

/** Stable group id derived from the shared group key K (all devices agree). */
const groupIdOf = async (rawK: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', rawK.slice().buffer)
  const bytes = new Uint8Array(digest).slice(0, 16)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `/settings` — vault settings: re-enroll, auto-lock, sync/pairing. */
export default function SettingsScreen() {
  const { api, navigate } = useScreen()
  const [reEnrollCode, setReEnrollCode] = createSignal('')
  const [invitation, setInvitation] = createSignal('')
  const [pairing, setPairing] = createSignal(false)
  const [pairError, setPairError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)
  const [diag, setDiag] = createSignal<string[]>([])
  // Identity ids chosen to share with an invitation. Initialized to "all" when
  // the picker opens (unlock / identity-set change / hide re-opens the form);
  // the user toggles individual ids off. GS4.
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  // GS6: paired-device roster (excluding this device) + remove.
  const [paired, setPaired] = createSignal<GroupDevice[]>([])
  const [admin, setAdmin] = createSignal(true) // only the admin device may revoke
  const [removeError, setRemoveError] = createSignal<string | null>(null)
  const [removing, setRemoving] = createSignal<string | null>(null)

  const loadPaired = async (): Promise<void> => {
    try {
      const node = await Effect.runPromise(readNodeIdentity())
      if (!node?.docId) {
        setPaired([])
        return
      }
      const meta = await Effect.runPromise(readMeta())
      setAdmin(meta?.isAdmin ?? true) // legacy hosts default to admin
      const adapter = getSyncAdapter()
      await adapter.start()
      await reopenPersistedDoc() // ensure the doc is open after a reload
      const rosterStr = await adapter.get(node.docId, DEVICES_KEY)
      if (!rosterStr) {
        setPaired([])
        return
      }
      setPaired(
        decodeDeviceList(rosterStr).devices.filter(
          (d) => d.deviceId !== meta?.deviceId,
        ),
      )
    } catch {
      setPaired([])
    }
  }

  // Refresh the roster whenever the vault unlocks.
  createEffect(
    () => (api.vault.status().kind === 'unlocked' ? 1 : 0),
    (active) => {
      if (active) void loadPaired()
      else setPaired([])
    },
  )

  const onRemoveDevice = async (deviceId: string): Promise<void> => {
    setRemoveError(null)
    setRemoving(deviceId)
    try {
      const node = await Effect.runPromise(readNodeIdentity())
      if (!node?.docId) return
      const session = await Effect.runPromise(vaultImpl.session())
      if (!session) throw new Error('vault locked')
      const meta = await Effect.runPromise(readMeta())
      if (!meta?.deviceId) throw new Error('no device identity')
      const adapter = getSyncAdapter()
      await adapter.start()

      // Fetch every remaining device's group envelope (for devicePublic rekeys).
      const rosterStr = await adapter.get(node.docId, DEVICES_KEY)
      const devices = rosterStr ? decodeDeviceList(rosterStr).devices : []
      const remainingEnvelopes = new Map<string, GroupEnvelope>()
      for (const d of devices) {
        if (d.deviceId === deviceId) continue
        const envStr = await adapter.get(node.docId, envelopeKey(d.deviceId))
        if (!envStr) continue
        try {
          remainingEnvelopes.set(d.deviceId, decodeGroupEnvelope(envStr))
        } catch {
          // Skip a remaining device whose envelope can't be decoded; it
          // (legacy, no ECDH key) can't be rekeyed anyway, and one bad
          // envelope must not abort the whole revocation.
        }
      }

      const { records, rekeys, hostEnvelope } = await Effect.runPromise(
        vaultImpl.revokeDevices({
          identities: session.vault.identities,
          removedDeviceIds: new Set([deviceId]),
          remainingEnvelopes,
        }),
      )
      for (const [id, rec] of records)
        await adapter.set(node.docId, id, encodeRecordDoc(rec))
      for (const [id, rk] of rekeys)
        await adapter.set(node.docId, rekeyKey(id), encodeRekeyDoc(rk))
      await adapter.set(
        node.docId,
        envelopeKey(meta.deviceId),
        encodeGroupEnvelope(hostEnvelope),
      )
      await adapter.set(
        node.docId,
        DEVICES_KEY,
        encodeDeviceList({
          v: 1,
          devices: devices.filter((d) => d.deviceId !== deviceId),
        }),
      )
      await loadPaired()
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e))
    } finally {
      setRemoving(null)
    }
  }

  /** Identities available to share from the unlocked session (reactive; empty while locked). */
  const shareableIdentities = createMemo<readonly Identity[]>(() => {
    const s = api.vault.status()
    return s.kind === 'unlocked' ? s.vault.identities : []
  })

  const resetSelection = (identities: readonly Identity[]): void => {
    setSelected(new Set(identities.map((i) => i.id)))
  }

  // Default the picker to "all" whenever the unlocked identity set changes
  // (unlock, join-import, save); the memo is cached between toggles, so manual
  // selections are not clobbered while the user is picking.
  // Solid 2 beta: createEffect requires the (compute, effect) two-arg form.
  // Default the selection to all identities whenever the unlocked set changes.
  createEffect(
    () => shareableIdentities(),
    (identities) => resetSelection(identities),
  )

  const toggleIdentity = (id: string): void => {
    const next = new Set(selected())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  // While the invitation is shown, poll spike-style connection diagnostics
  // (relay / node / doc sync) so the host can see its sync state.
  createEffect(
    () => invitation(),
    (inv) => {
      if (!inv) {
        setDiag([])
        return
      }
      const timer = window.setInterval(() => {
        const s = getSyncAdapter()
        void (async () => {
          try {
            const docId = s.docIdFromTicket(inv)
            const lines: string[] = []
            lines.push(`relay: ${await s.relayStatus()}`)
            lines.push(`node: ${await s.nodeId()}`)
            lines.push(`sync: ${await s.syncStatus(docId)}`)
            lines.push(`peers: ${await s.syncPeers(docId)}`)
            setDiag(lines)
          } catch {
            // node not up yet — skip this tick
          }
        })()
      }, 3000)
      onCleanup(() => window.clearInterval(timer))
    },
  )

  // Bound the whole create-invitation flow so a hanging relay (wasm ensure_online
  // waiting for the WebSocket) surfaces an error instead of an eternal "Creating…".
  const INVITE_TIMEOUT_MS = 45_000
  const withInviteTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `timed out creating the invitation (${INVITE_TIMEOUT_MS}ms) — is the relay reachable?`,
              ),
            ),
          INVITE_TIMEOUT_MS,
        ),
      ),
    ])

  const onCreateInvitation = async (): Promise<void> => {
    setPairing(true)
    setPairError(null)
    try {
      const sync = getSyncAdapter()
      const raw = await withInviteTimeout(
        Effect.runPromise(vaultImpl.exportGroupKey()),
      )
      const session = await withInviteTimeout(
        Effect.runPromise(vaultImpl.session()),
      )
      if (!session) throw new Error('vault locked')
      const meta = await withInviteTimeout(Effect.runPromise(readMeta()))
      if (!meta?.deviceId) throw new Error('no device identity')
      const groupId = await groupIdOf(new Uint8Array(raw))
      // GS4: share only the identities the host selected in the picker;
      // unselected identities never reach the invitation's doc.
      const selectedIds = selected()
      const identities = session.vault.identities.filter((i) =>
        selectedIds.has(i.id),
      )
      const created = await withInviteTimeout(
        createGroupInvitation({
          sync,
          groupId,
          deviceId: meta.deviceId,
          identities,
          groupKeyRaw: new Uint8Array(raw),
          persist: (t, docId) => persistDoc(t, docId),
        }),
      )
      setInvitation(created)
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String(e))
    } finally {
      setPairing(false)
    }
  }

  const onCopyInvitation = (): void => {
    void navigator.clipboard?.writeText(invitation())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div data-screen="settings" class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <p class="text-lg font-medium text-slate-100">Settings</p>
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          onClick={() => navigate('/')}
        >
          ← identities
        </button>
      </div>
      <Card variant="dashed">
        <form
          class="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void api.vault.reEnrollPasskey(reEnrollCode()).then((v) => {
              if (v) setReEnrollCode('')
            })
          }}
        >
          <Hint>
            Lost your passkey? Re-enroll a new one (rotates the vault key):
          </Hint>
          <Input
            label="Recovery code"
            value={reEnrollCode()}
            onInput={(e) => setReEnrollCode(e.currentTarget.value)}
            placeholder="recovery code"
            autocomplete="current-password"
          />
          <Button
            variant="primary"
            type="submit"
            disabled={reEnrollCode().length < 8}
          >
            Replace passkey
          </Button>
        </form>
      </Card>
      <Card variant="dashed">
        <Hint>Auto-lock after inactivity or hiding the app:</Hint>
        <Select
          options={AUTO_LOCK_OPTIONS}
          value={
            AUTO_LOCK_OPTIONS.find(
              (o) => o.value === api.vault.prefs().autoLockMinutes,
            ) ?? AUTO_LOCK_OPTIONS[0]
          }
          onChange={(opt) => void api.vault.setAutoLockMinutes(opt.value)}
        />
      </Card>
      <Card variant="dashed">
        <Hint>
          Sync with another device (experimental — the other device scans or
          pastes this invitation):
        </Hint>
        <Show when={!invitation()}>
          <Show when={shareableIdentities().length > 0}>
            <div class="flex flex-col gap-1 pt-1">
              <Hint>Share which identities?</Hint>
              <For each={shareableIdentities()}>
                {(identity) => (
                  <label class="flex cursor-pointer items-center gap-2 rounded border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100">
                    <input
                      type="checkbox"
                      class="h-4 w-4 shrink-0 accent-teal-spectre"
                      checked={selected().has(identity.id)}
                      onChange={() => toggleIdentity(identity.id)}
                    />
                    <span>{identity.fullName}</span>
                  </label>
                )}
              </For>
              <p
                class={`text-xs ${
                  selected().size === 0 ? 'text-red-400' : 'text-slate-500'
                }`}
              >
                {selected().size === 0
                  ? 'Select at least one identity to share'
                  : `${selected().size} of ${shareableIdentities().length} selected`}
              </p>
            </div>
          </Show>
          <Button
            variant="primary"
            disabled={pairing() || selected().size === 0}
            onClick={() => void onCreateInvitation()}
          >
            {pairing() ? 'Creating…' : 'Create invitation'}
          </Button>
        </Show>
        <Show when={invitation()}>
          <QrCode
            value={invitation()}
            class="h-auto w-full max-w-sm self-center text-surface-950"
          />
          <p class="text-xs break-all text-slate-400">{invitation()}</p>
          <Show when={diag().length}>
            <pre class="rounded border border-surface-700 bg-surface-800 p-2 text-xs text-slate-400">
              {diag().join('\n')}
            </pre>
          </Show>
          <div class="flex items-center gap-2">
            <Button variant="secondary" onClick={onCopyInvitation}>
              {copied() ? 'copied' : 'Copy invitation'}
            </Button>
            <button
              class="text-xs text-slate-500 underline hover:text-slate-300"
              onClick={() => {
                setInvitation('')
                // Re-opening the form re-initializes the picker to "all".
                resetSelection(shareableIdentities())
              }}
            >
              hide
            </button>
          </div>
        </Show>
        <Show when={pairError()}>
          <p class="text-xs text-red-400">{pairError()}</p>
        </Show>
      </Card>
      <Card variant="dashed">
        <Hint>Paired devices (settings — remove revokes access via key rotation):</Hint>
        <Show when={removeError()}>
          <p class="text-xs text-red-400">{removeError()}</p>
        </Show>
        <Show
          when={paired().length === 0}
          fallback={
            <ul class="flex flex-col gap-2">
              <For each={paired()}>
                {(dev) => (
                  <li class="flex items-center justify-between gap-2 rounded border border-surface-700 px-3 py-2">
                    <span class="text-sm text-slate-200">
                      {dev.deviceId.slice(0, 8)}…
                    </span>
                    <Show when={admin()}>
                      <Button
                        variant="secondary"
                        disabled={removing() !== null}
                        onClick={() => void onRemoveDevice(dev.deviceId)}
                      >
                        {removing() === dev.deviceId ? 'Removing…' : 'Remove'}
                      </Button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          }
        >
          <p class="text-xs text-slate-400">
            No other paired devices yet.
          </p>
        </Show>
        <Show when={!admin()}>
          <p class="text-xs text-slate-500">
            Only the device that created this vault can remove devices.
          </p>
        </Show>
      </Card>
    </div>
  )
}
