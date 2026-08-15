import type { JSX } from '@solidjs/web'

type CardVariant = 'solid' | 'dashed'

const VARIANT_CLASS: Record<CardVariant, string> = {
  solid: 'rounded border border-surface-700 bg-surface-800',
  dashed:
    'flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3',
}

/** B/W-themed container. `solid` = filled panel; `dashed` = form section. */
export function Card(props: {
  variant?: CardVariant
  class?: string
  children?: JSX.Element
}) {
  return (
    <div
      class={`${VARIANT_CLASS[props.variant ?? 'dashed']} ${props.class ?? ''}`}
    >
      {props.children}
    </div>
  )
}
