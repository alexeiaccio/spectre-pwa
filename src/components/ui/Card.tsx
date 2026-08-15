import { splitProps } from 'solid-js'
import type { ComponentProps, ParentComponent } from 'solid-js'

type CardVariant = 'solid' | 'dashed'

const VARIANT_CLASS: Record<CardVariant, string> = {
  solid: 'rounded border border-surface-700 bg-surface-800',
  dashed: 'flex flex-col gap-2 rounded border border-dashed border-surface-700 p-3',
}

/** B/W-themed container. `solid` = filled panel; `dashed` = form section. */
export const Card: ParentComponent<
  ComponentProps<'div'> & { variant?: CardVariant }
> = (props) => {
  const [local, rest] = splitProps(props, ['variant', 'class'])
  return (
    <div
      {...rest}
      class={`${VARIANT_CLASS[local.variant ?? 'dashed']} ${local.class ?? ''}`}
    />
  )
}
