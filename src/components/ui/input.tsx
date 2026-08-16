import {
  Input as TextFieldInput,
  Label as TextFieldLabel,
  Root as TextFieldRoot,
} from '@kobalte/core/text-field'
import type { JSX } from '@solidjs/web'

/** B/W-themed labelled text input (Kobalte TextField). `w-full` + touch target by default. */
export function Input(props: {
  class?: string
  label?: string
  value?: string
  placeholder?: string
  type?: string
  title?: string
  autocomplete?: string
  revealable?: boolean
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>
}) {
  return (
    <TextFieldRoot>
      {props.label ? (
        <TextFieldLabel class="block text-xs text-slate-500">
          {props.label}
        </TextFieldLabel>
      ) : null}
      <TextFieldInput
        class={`tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${props.class ?? ''}`}
        value={props.value}
        placeholder={props.placeholder}
        type={props.type}
        title={props.title}
        autocomplete={props.autocomplete}
        revealable={props.revealable}
        onInput={props.onInput}
      />
    </TextFieldRoot>
  )
}
