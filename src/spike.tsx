import { createSignal, Show } from 'solid-js'
import { render } from '@solidjs/web'
// wasm-bindgen emits both a default export (init) and a named `initSync`;
// importing it as the default is the documented `--target web` pattern.
// oxlint-disable-next-line import/no-named-as-default
import initSync, { SyncNode } from './lib/spike/spectre_sync.js'

/** S4 spike: two tabs exchange a record over the n0 relay. Role via ?tab=A|B. */

const ROLE: 'A' | 'B' =
  new URLSearchParams(location.search).get('tab') === 'B' ? 'B' : 'A'
const TICKET_KEY = 'spike-ticket'

interface Log {
  text: string
}

function App() {
  const [status, setStatus] = createSignal('idle')
  const [ticket, setTicket] = createSignal(
    localStorage.getItem(TICKET_KEY) ?? '',
  )
  const [docId, setDocId] = createSignal('')
  const [logs, setLogs] = createSignal<Log[]>([])
  const [sent, setSent] = createSignal<string[]>([])
  const [received, setReceived] = createSignal<string[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [diag, setDiag] = createSignal<string[]>([])

  let node: SyncNode | null = null

  const log = (text: string): void => {
    setLogs((l) => [...l, { text }])
  }

  const boot = async (): Promise<void> => {
    setError(null)
    setStatus('loading-wasm')
    try {
      await initSync()
      setStatus('starting-node')
      log(`node ${ROLE}: endpoint bind (n0 relay)…`)
      node = await SyncNode.start()
      // oxlint-disable-next-line eslint/no-underscore-dangle
      ;(window as unknown as { __spikeNode: SyncNode | null }).__spikeNode =
        node
      setStatus('ready')
      setDiag((d) => [...d, `node ${ROLE} id: ${node!.node_id()}`])
      setDiag((d) => [...d, `node ${ROLE} relay: ${node!.relay_status()}`])
      log(`node ${ROLE} ready`)
      if (ROLE === 'A')
        log('A: create a doc, then B joins via the ticket (localStorage)')
      else log('B: waiting for ticket from A')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const createDoc = async (): Promise<void> => {
    if (!node || ROLE !== 'A') return
    try {
      setStatus('creating')
      const t = await node.create_doc()
      setTicket(t)
      localStorage.setItem(TICKET_KEY, t)
      localStorage.setItem('spike-peer', node.node_id())
      log(`A: doc created; ticket: ${t.slice(0, 24)}…`)
      const info = node.ticket_info(t)
      setDiag((d) => [...d, `ticket nodes: ${info}`])
      // A learns its own doc id from the ticket (no self-dial).
      const id = node.doc_id_from_ticket(t)
      setDocId(id)
      log(`A: doc id ${id.slice(0, 16)}…`)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const joinFromB = async (): Promise<void> => {
    if (!node || ROLE !== 'B' || !ticket()) return
    try {
      setStatus('joining')
      // Imports the doc, dials peers via their relay address (held), and retries
      // start_sync until the engine's sync attempt lands.
      const id = await node.join_and_sync(ticket())
      log(`B: imported ticket; doc ${id.slice(0, 16)}…`)
      node
        .subscribe(id, (v: unknown) => {
          const s = String(v)
          if (s.startsWith('SYNC:') || s.startsWith('NEIGHBOR_UP:')) {
            log(`B: ${s}`)
          } else {
            setReceived((r) => [...r, s])
            log(`B: RECEIVED: ${s}`)
          }
        })
        .then(() => log('B: subscribed to live events'))
      setDocId(id)
      setStatus('ready')
      const dump = async (): Promise<void> => {
        const s1 = await node!.sync_status(id)
        const s2 = await node!.sync_peers(id)
        setDiag((d) => [...d, `B sync_status: ${s1}`])
        setDiag((d) => [...d, `B sync_peers: ${s2}`])
      }
      void dump()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const send = async (): Promise<void> => {
    if (!node || ROLE !== 'A' || !ticket() || !docId()) return
    try {
      const value = `hello-from-A-${Date.now()}`
      await node.set(docId(), 'greeting', value)
      setSent((s) => [...s, value])
      log(`A: set(greeting) = ${value}`)
      const dump = async (): Promise<void> => {
        const s1 = await node!.sync_status(docId())
        const s2 = await node!.sync_peers(docId())
        setDiag((d) => [...d, `A sync_status: ${s1}`])
        setDiag((d) => [...d, `A sync_peers: ${s2}`])
      }
      void dump()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const isA = ROLE === 'A'
  const isB = ROLE === 'B'

  return (
    <div
      style={{
        'max-width': '640px',
        margin: '0 auto',
        padding: '16px',
        font: '14px/1.5 system-ui',
        color: '#e2e8f0',
        background: '#0f172a',
        'min-height': '100vh',
      }}
    >
      <h1 style={{ 'font-size': '18px', margin: '0 0 4px' }}>
        S4 — iroh sync spike · tab {ROLE}
      </h1>
      <p style={{ color: '#94a3b8', margin: '0 0 16px' }}>
        Open two tabs (spike.html?tab=A and ?tab=B). A creates the doc and
        sends; B joins via the ticket and receives. Traffic flows over the n0
        public relay, E2E-encrypted.
      </p>

      <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '16px' }}>
        <button
          onClick={() => void boot()}
          disabled={status() !== 'idle' && status() !== 'error'}
          style={btn}
        >
          Boot node
        </button>
        <Show when={isA}>
          <button
            onClick={() => void createDoc()}
            disabled={status() !== 'ready'}
            style={btn}
          >
            A: create doc
          </button>
          <button
            onClick={() => void send()}
            disabled={status() !== 'ready' || !docId()}
            style={btn}
          >
            A: send record
          </button>
        </Show>
        <Show when={isB}>
          <button
            onClick={() => void joinFromB()}
            disabled={status() !== 'ready' || !ticket()}
            style={btn}
          >
            B: join via ticket
          </button>
        </Show>
      </div>

      <Show when={status() !== 'idle'}>
        <p style={{ color: '#67e8f9', margin: '0 0 8px' }}>
          status: {status()}
        </p>
      </Show>
      <Show when={isA && ticket()}>
        <p
          style={{
            'word-break': 'break-all',
            color: '#a5b4fc',
            margin: '0 0 8px',
          }}
        >
          ticket: {ticket()}
        </p>
      </Show>
      <Show when={isB && !ticket()}>
        <p style={{ color: '#a5b4fc', margin: '0 0 8px' }}>
          no ticket yet — create it in tab A first
        </p>
      </Show>
      <Show when={docId()}>
        <p
          style={{
            'word-break': 'break-all',
            color: '#a5b4fc',
            margin: '0 0 8px',
          }}
        >
          doc id: {docId()}
        </p>
      </Show>
      <Show when={error()}>
        <p style={{ color: '#fca5a5', margin: '0 0 8px' }}>error: {error()}</p>
      </Show>
      <Show when={diag().length}>
        <div style={{ margin: '0 0 8px' }}>
          <h2
            style={{ 'font-size': '13px', color: '#94a3b8', margin: '0 0 4px' }}
          >
            diagnostics
          </h2>
          <pre
            style={{
              'white-space': 'pre-wrap',
              'font-size': '12px',
              color: '#cbd5e1',
              margin: '0',
            }}
          >
            {diag().join('\n')}
          </pre>
        </div>
      </Show>

      <div style={{ display: 'flex', gap: '16px', 'margin-top': '12px' }}>
        <div style={{ flex: '1' }}>
          <h2
            style={{ 'font-size': '13px', color: '#94a3b8', margin: '0 0 4px' }}
          >
            A sent
          </h2>
          <pre style={{ 'white-space': 'pre-wrap', margin: '0' }}>
            {sent().join('\n') || '—'}
          </pre>
        </div>
        <div style={{ flex: '1' }}>
          <h2
            style={{ 'font-size': '13px', color: '#94a3b8', margin: '0 0 4px' }}
          >
            B received
          </h2>
          <pre style={{ 'white-space': 'pre-wrap', margin: '0' }}>
            {received().join('\n') || '—'}
          </pre>
        </div>
      </div>

      <h2
        style={{ 'font-size': '13px', color: '#94a3b8', margin: '20px 0 4px' }}
      >
        log
      </h2>
      <pre
        style={{
          'white-space': 'pre-wrap',
          'font-size': '12px',
          color: '#64748b',
        }}
      >
        {logs()
          .map((l) => l.text)
          .join('\n') || '—'}
      </pre>
    </div>
  )
}

const btn =
  'padding: 6px 10px; border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; cursor: pointer'

render(() => <App />, document.getElementById('root')!)
