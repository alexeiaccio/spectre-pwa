import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { ErrorText, Hint } from './text.tsx'

type Status = 'starting' | 'scanning' | 'error'

const cameraErrorMessage = (e: unknown): string => {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
        return 'Camera access denied — allow camera in the browser/site settings.'
      case 'NotFoundError':
        return 'No camera found on this device.'
      case 'NotReadableError':
        return 'Camera is busy — close other apps that use it.'
      case 'SecurityError':
        return 'Camera needs a secure (HTTPS) connection.'
    }
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * Camera QR scanner: acquires the rear camera directly (ideal facingMode so a
 * missing rear camera falls back cleanly), attaches it to the <video>, and
 * decodes continuously via @zxing/browser. Stops + releases the stream on the
 * first read and on unmount. Errors are surfaced with actionable text.
 */
export function QrScanner(props: {
  onScan: (text: string) => void
  onError?: (e: unknown) => void
}) {
  // The video ref must be a signal: a plain `let` is read once, non-reactively,
  // so the setup effect would see `undefined` (Solid 2 effects run before the
  // ref callback assigns it) and never request the camera.
  const [video, setVideo] = createSignal<HTMLVideoElement | undefined>()
  let controls: IScannerControls | null = null
  let stream: MediaStream | null = null
  let pendingTimer: number | null = null
  let settled = false
  let started = false
  const [status, setStatus] = createSignal<Status>('starting')
  const [message, setMessage] = createSignal('')

  const stopCamera = (): void => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    controls?.stop()
    controls = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }
  onCleanup(stopCamera)

  // Solid 2 rc has no onMount — the effect runs on the video signal changing
  // (ref assigned during render), which also re-runs if the parent swaps props.
  createEffect(
    () => ({ video: video(), onScan: props.onScan, onError: props.onError }),
    ({ video, onScan, onError }) => {
      if (!video || started) return
      started = true

      const start = async (): Promise<void> => {
        let s: MediaStream
        try {
          s = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' } },
          })
        } catch {
          // No usable rear camera (or constraint unsupported) — retry with the
          // default camera before surfacing an error.
          try {
            s = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: true,
            })
          } catch (e2) {
            settled = true
            setStatus('error')
            setMessage(cameraErrorMessage(e2))
            onError?.(e2)
            return
          }
        }
        stream = s
        video.srcObject = s
        video.muted = true
        video.setAttribute('playsinline', '')
        try {
          await video.play()
        } catch {
          // Muted autoplay is allowed; a throw here is unusual — keep going.
        }
        const reader = new BrowserQRCodeReader()
        controls = await reader.decodeFromStream(s, video, (result, err) => {
          if (result) {
            stopCamera()
            onScan(result.getText())
          } else if (err) {
            setMessage(err.message)
          }
        })
        settled = true
        setStatus('scanning')
      }

      void start().catch((e: unknown) => {
        settled = true
        setStatus('error')
        setMessage(cameraErrorMessage(e))
        onError?.(e)
      })

      // If the permission prompt never appears, tell the user instead of
      // leaving "Starting camera…" forever.
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null
        if (!settled) {
          setMessage(
            'Waiting for camera permission — allow access when prompted.',
          )
        }
      }, 8000)
    },
  )

  return (
    <div class="flex flex-col gap-2">
      <video
        ref={setVideo}
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
      <Show when={status() === 'starting' && message()}>
        <Hint>{message()}</Hint>
      </Show>
    </div>
  )
}
