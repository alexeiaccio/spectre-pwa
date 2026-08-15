import type { JSX } from '@solidjs/web'

type ButtonVariant = 'primary' | 'secondary'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'tap rounded bg-teal-spectre px-3 py-2 text-sm font-medium text-black',
  secondary:
    'tap rounded border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100',
}

/** B/W-themed button. `primary` = white bg + black text; `secondary` = outlined. */
export function Button(props: {
  variant?: ButtonVariant
  class?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  children?: JSX.Element
}) {
  const cls = () =>
    `${VARIANT_CLASS[props.variant ?? 'primary']} disabled:opacity-40 ${props.class ?? ''}`
  return (
    <button
      type={props.type ?? 'button'}
      class={cls()}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
