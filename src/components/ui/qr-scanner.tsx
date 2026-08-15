import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { ErrorText, Hint } from './text.tsx'

/**
 * Camera QR scanner: starts the rear camera (environment), decodes
 * continuously, and stops on the first successful read. Used on device B to
 * scan the host's DocTicket invitation. Cleans up the stream on unmount.
 */
export function QrScanner(props: {
  onScan: (text: string) => void
  onError?: (e: unknown) => void
}) {
  let videoEl: HTMLVideoElement | undefined
  let controls: IScannerControls | null = null
  const [status, setStatus] = createSignal<'starting' | 'scanning' | 'error'>(
    'starting',
  )
  const [message, setMessage] = createSignal('')

  onCleanup(() => {
    controls?.stop()
    controls = null
  })

  // Solid 2 rc has no onMount — a depless effect runs once after the video ref
  // is assigned (refs are set during render, effects flush after).
  createEffect(
    () => ({ video: videoEl, onScan: props.onScan, onError: props.onError }),
    ({ video, onScan, onError }) => {
      if (!video || controls) return
      const reader = new BrowserQRCodeReader()
      reader
        .decodeFromConstraints(
          { video: { facingMode: 'environment' }, audio: false },
          video,
          (result, err) => {
            if (result) {
              controls?.stop()
              controls = null
              onScan(result.getText())
            } else if (err) {
              setMessage(err.message)
            }
          },
        )
        .then((c) => {
          controls = c
          setStatus('scanning')
        })
        .catch((e: unknown) => {
          setStatus('error')
          setMessage(e instanceof Error ? e.message : String(e))
          onError?.(e)
        })
    },
  )

  return (
    <div class="flex flex-col gap-2">
      <video
        ref={(el) => {
          videoEl = el
        }}
        autoplay
        muted
        playsinline
        class="aspect-square w-full rounded border border-surface-700 bg-black object-cover"
      />
      <Show when={status() === 'starting'}>
        <Hint>Starting camera…</Hint>
      </Show>
      <Show when={status() === 'scanning'}>
        <Hint>Point this device at the invitation QR code.</Hint>
      </Show>
      <Show when={status() === 'error'}>
        <ErrorText>{message()}</ErrorText>
      </Show>
    </div>
  )
}
