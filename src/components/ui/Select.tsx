import {
  Content as SelectContent,
  Item as SelectItem,
  ItemLabel as SelectItemLabel,
  Listbox as SelectListbox,
  Portal as SelectPortal,
  Root as SelectRoot,
  Trigger as SelectTrigger,
  Value as SelectValue,
} from '@kobalte/core/select'

interface SelectOption {
  value: number | string
  label: string
}

/** B/W-themed single Kobalte Select. Focused item inverts to white/black. */
export function Select<T extends SelectOption>(props: {
  options: T[]
  value: T
  onChange: (opt: T) => void
  class?: string
}) {
  return (
    <SelectRoot<T>
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={props.value}
      onChange={(opt) => {
        if (opt) props.onChange(opt)
      }}
      itemComponent={(p) => (
        <SelectItem
          item={p.item}
          class="flex tap items-center justify-between gap-2 px-3 py-2 text-sm text-slate-100 data-[highlighted]:bg-white data-[highlighted]:text-black"
        >
          <SelectItemLabel>{p.item.rawValue.label}</SelectItemLabel>
        </SelectItem>
      )}
    >
      <SelectTrigger class="flex tap w-full min-w-0 items-center justify-between gap-2 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100">
        <SelectValue<T>>
          {(state) => state.selectedOption()?.label ?? '…'}
        </SelectValue>
        <span class="shrink-0 text-xs text-slate-500">▾</span>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent class="z-10 min-w-[10rem] overflow-hidden rounded border border-surface-700 bg-surface-800 p-1 shadow-lg">
          <SelectListbox />
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  )
}
