import {
  Input as NumberFieldInput,
  Root as NumberFieldRoot,
} from '@kobalte/core/number-field'

/** B/W-themed numeric input (Kobalte NumberField), compact for a form row. */
export function NumberField(props: {
  class?: string
  value: number
  minValue?: number
  onChange: (value: number) => void
  title?: string
}) {
  return (
    <NumberFieldRoot
      value={props.value}
      minValue={props.minValue}
      onChange={(v) => props.onChange(Number(v))}
    >
      <NumberFieldInput
        class={`tap w-16 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${props.class ?? ''}`}
        title={props.title}
      />
    </NumberFieldRoot>
  )
}
