import { createEffect, createSignal } from 'solid-js'
import {
  computeIdenticon,
  EMPTY_IDENTICON,
  type Identicon,
} from '../../lib/spectre/identicon.ts'

/**
 * Reactive identicon source: recomputes when the name or secret changes and
 * yields a placeholder until both are entered. Cheap (single HMAC), safe to
 * drive from a per-keystroke signal. A sequence token drops stale async writes
 * when inputs change mid-computation.
 */
export function useIdenticon(
  fullName: () => string,
  secret: () => string,
): () => Identicon {
  const [icon, setIcon] = createSignal<Identicon>(EMPTY_IDENTICON)
  let seq = 0
  createEffect(
    () => {
      const name = fullName()
      const s = secret()
      return name.trim().length > 0 && s.length > 0 ? { name, s } : null
    },
    (inputs) => {
      if (!inputs) {
        setIcon(EMPTY_IDENTICON)
        return
      }
      const id = ++seq
      void computeIdenticon(inputs.name, inputs.s).then((value) => {
        if (id === seq) setIcon(value)
      })
    },
  )
  return icon
}

/**
 * Renders the 4-glyph identicon figure in its derived color. The empty
 * placeholder keeps its footprint (same 4 monospace glyphs) but stays
 * invisible — a row of dim dots reads as rendering artifacts, not a hint.
 */
export function Identicon(props: { value: () => Identicon; size?: 'lg' }) {
  const cls = () => {
    const base =
      props.size === 'lg'
        ? 'font-mono text-3xl leading-none'
        : 'font-mono text-xl leading-none'
    return props.value() === EMPTY_IDENTICON
      ? `${base} invisible`
      : base
  }
  return (
    <span
      class={cls()}
      style={{ color: props.value().color }}
      aria-hidden="true"
    >
      {props.value().glyphs}
    </span>
  )
}
