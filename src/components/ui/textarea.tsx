import type { JSX } from '@solidjs/web'

/** B/W-themed multiline textarea, `w-full` + touch target. */
export function Textarea(props: {
  class?: string
  value?: string
  placeholder?: string
  onInput?: JSX.EventHandlerUnion<HTMLTextAreaElement, InputEvent>
}) {
  return (
    <textarea
      class={`min-h-24 tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${props.class ?? ''}`}
      value={props.value}
      placeholder={props.placeholder}
      onInput={props.onInput}
    />
  )
}
