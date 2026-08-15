import { createSignal, Show } from 'solid-js'
import { BrowserQRCodeReader } from '@zxing/browser'
import jsQR from 'jsqr'
import { Button } from './button.tsx'
import { ErrorText, Hint } from './text.tsx'

/** Try zxing then jsQR (with inversion) on a canvas; null if neither reads it. */
const decodeCanvas = async (canvas: HTMLCanvasElement): Promise<string | null> => {
  try {
    const result = new BrowserQRCodeReader().decodeFromCanvas(canvas)
    return result.getText()
  } catch {
    /* fall through to jsQR */
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const res = jsQR(data.data, data.width, data.height, {
      inversionAttempts: 'attemptBoth',
    })
    return res?.data ?? null
  } catch {
    return null
  }
}

/**
 * Picks an image (screenshot / saved QR) from the device and decodes the
 * invitation QR out of it. A no-camera fallback for scanning. Tries zxing at
 * 1x/2x/3x scale, then jsQR, so small or slightly blurred screenshots still
 * work.
 */
export function QrImagePicker(props: { onScan: (text: string) => void }) {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let inputRef: HTMLInputElement | undefined

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const url = URL.createObjectURL(file)
      try {
        const img = new Image()
        img.src = url
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
        })
        let text: string | null = null
        for (const scale of [1, 2, 3]) {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth * scale
          canvas.height = img.naturalHeight * scale
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          text = await decodeCanvas(canvas)
          if (text) break
        }
        if (text) props.onScan(text)
        else setError('No QR code found in that image — try a sharper screenshot.')
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      setError('Could not read that image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex flex-col gap-2">
      <Button
        variant="secondary"
        disabled={busy()}
        onClick={() => inputRef?.click()}
      >
        {busy() ? 'Reading image…' : 'Choose a QR image'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        class="hidden"
        tabindex={-1}
        aria-hidden="true"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <Show when={error()}>
        <ErrorText>{error()}</ErrorText>
      </Show>
      <Show when={busy()}>
        <Hint>Decoding the QR code…</Hint>
      </Show>
    </div>
  )
}
