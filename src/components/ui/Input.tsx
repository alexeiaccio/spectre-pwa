import { Input as TextFieldInput, Root as TextFieldRoot } from '@kobalte/core/text-field'
import type { JSX } from '@solidjs/web'

/** B/W-themed text input (Kobalte TextField). `w-full` + touch target by default. */
export function Input(props: {
  class?: string
  value?: string
  placeholder?: string
  type?: string
  title?: string
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>
}) {
  return (
    <TextFieldRoot>
      <TextFieldInput
        class={`tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${props.class ?? ''}`}
        value={props.value}
        placeholder={props.placeholder}
        type={props.type}
        title={props.title}
        onInput={props.onInput}
      />
    </TextFieldRoot>
  )
}
