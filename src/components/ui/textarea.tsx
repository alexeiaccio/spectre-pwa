import { Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

const nextId = (): string => `textarea-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

/** B/W-themed labelled multiline textarea, `w-full` + touch target. */
export function Textarea(props: {
  class?: string
  label?: string
  value?: string
  placeholder?: string
  onInput?: JSX.EventHandlerUnion<HTMLTextAreaElement, InputEvent>
}) {
  const id = nextId()
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.label}>
        <label class="text-xs text-slate-500" for={id}>
          {props.label}
        </label>
      </Show>
      <textarea
        id={id}
        class={`min-h-24 tap w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 ${props.class ?? ''}`}
        value={props.value}
        placeholder={props.placeholder}
        onInput={props.onInput}
      />
    </div>
  )
}
