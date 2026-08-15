import { splitProps } from 'solid-js'
import { Input as NumberFieldInput, Root as NumberFieldRoot } from '@kobalte/core/number-field'
import type { ComponentProps } from 'solid-js'

/** B/W-themed numeric input (Kobalte NumberField), compact for a form row. */
export function NumberField(
  props: ComponentProps<'input'> & {
    value: number
    minValue?: number
    onChange: (value: number) => void
    rootClass?: string
  },
) {
  const [local, rest] = splitProps(props, ['value', 'minValue', 'onChange', 'rootClass', 'class'])
  return (
    <NumberFieldRoot
      value={local.value}
      minValue={local.minValue}
      onChange={(v) => local.onChange(Number(v))}
      class={local.rootClass}
    >
      <NumberFieldInput
        {...rest}
        class={`tap w-16 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${local.class ?? ''}`}
      />
    </NumberFieldRoot>
  )
}
