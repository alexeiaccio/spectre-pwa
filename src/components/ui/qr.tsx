import { createMemo, For } from 'solid-js'
import { encode } from 'uqr'

/** Renders a QR code as inline SVG rects (avoids innerHTML entirely). */
export function QrCode(props: {
  value: string
  pixelSize?: number
  border?: number
  class?: string
}) {
  const qr = createMemo(() =>
    encode(props.value, { border: props.border ?? 2 }),
  )
  const px = createMemo(() => props.pixelSize ?? 5)
  const size = createMemo(() => qr().size * px())
  return (
    <svg
      width={size()}
      height={size()}
      viewBox={`0 0 ${size()} ${size()}`}
      shape-rendering="crispEdges"
      role="img"
      aria-label="QR code"
      class={props.class}
    >
      <rect width={size()} height={size()} fill="white" />
      <For each={qr().data}>
        {(row, y) => (
          <For each={row}>
            {(on, x) =>
              on ? (
                <rect
                  x={x() * px()}
                  y={y() * px()}
                  width={px()}
                  height={px()}
                  fill="currentColor"
                />
              ) : null
            }
          </For>
        )}
      </For>
    </svg>
  )
}
