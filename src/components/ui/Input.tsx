import { splitProps } from 'solid-js'
import { Input as TextFieldInput, Root as TextFieldRoot } from '@kobalte/core/text-field'
import type { ComponentProps } from 'solid-js'

/** B/W-themed text input (Kobalte TextField). `w-full` + touch target by default. */
export function Input(
  props: ComponentProps<'input'> & { rootClass?: string },
) {
  const [local, rest] = splitProps(props, ['rootClass', 'class'])
  return (
    <TextFieldRoot class={local.rootClass}>
      <TextFieldInput
        {...rest}
        class={`tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${local.class ?? ''}`}
      />
    </TextFieldRoot>
  )
}
