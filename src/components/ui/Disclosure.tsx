import {
  Content as CollapsibleContent,
  Root as CollapsibleRoot,
  Trigger as CollapsibleTrigger,
} from '@kobalte/core/collapsible'
import type { JSX } from '@solidjs/web'

/** B/W-themed collapsible (disclosure): a tap trigger toggling a content panel. */
export function Disclosure(props: {
  label: string
  defaultOpen?: boolean
  children?: JSX.Element
}) {
  return (
    <CollapsibleRoot defaultOpen={props.defaultOpen}>
      <CollapsibleTrigger class="flex tap w-full items-center justify-between gap-2 rounded border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100">
        <span>{props.label}</span>
        <span class="shrink-0 text-xs text-slate-500">▾</span>
      </CollapsibleTrigger>
      <CollapsibleContent class="flex flex-col gap-2 border-t border-surface-700 p-3">
        {props.children}
      </CollapsibleContent>
    </CollapsibleRoot>
  )
}
