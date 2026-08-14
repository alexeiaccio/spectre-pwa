import { Show } from 'solid-js'
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
import {
  Input as NumberFieldInput,
  Root as NumberFieldRoot,
} from '@kobalte/core/number-field'
import {
  Input as TextFieldInput,
  Root as TextFieldRoot,
} from '@kobalte/core/text-field'
import type { Site } from '../lib/vault/schema.ts'

export const PURPOSE_LABEL: Record<Site['purpose'], string> = {
  password: 'password',
  login: 'login name',
  answer: 'security answer',
}

export const TEMPLATES: Record<string, number> = {
  Long: 17,
  Maximum: 16,
  Medium: 18,
  Short: 19,
  Basic: 20,
  PIN: 21,
  'Login name': 30,
  Phrase: 31,
}

const PURPOSE_OPTIONS: { value: Site['purpose']; label: string }[] = [
  { value: 'password', label: 'password' },
  { value: 'login', label: 'login name' },
  { value: 'answer', label: 'security answer' },
]

const TEMPLATE_OPTIONS: { value: number; label: string }[] = Object.entries(
  TEMPLATES,
).map(([label, id]) => ({ value: id, label }))

/** Compact B/W-styled single Kobalte Select for the site form row. */
function MiniSelect<
  T extends { value: number | string; label: string },
>(props: { options: T[]; value: T; onChange: (opt: T) => void }) {
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
          class="flex tap items-center justify-between gap-2 px-3 py-2 text-sm text-slate-100 data-[highlighted]:bg-surface-700 data-[selected]:text-black"
        >
          <SelectItemLabel>{p.item.rawValue.label}</SelectItemLabel>
        </SelectItem>
      )}
    >
      <SelectTrigger class="flex tap items-center justify-between gap-2 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100">
        <SelectValue<T>>
          {(state) => state.selectedOption()?.label ?? '…'}
        </SelectValue>
        <span class="text-xs text-slate-500">▾</span>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent class="z-10 min-w-[10rem] overflow-hidden rounded border border-surface-700 bg-surface-800 p-1 shadow-lg">
          <SelectListbox />
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  )
}

export interface SiteFormState {
  name: string
  purpose: Site['purpose']
  template: number
  answer: string
  counter: number
}

export const NEW_SITE_DRAFT: SiteFormState = {
  name: '',
  purpose: 'password',
  template: 17,
  answer: '',
  counter: 1,
}

/** Shared name/purpose/template/counter/answer field set for the add-site and edit-site forms. */
export function SiteFields(props: {
  draft: SiteFormState
  setDraft: (u: (d: SiteFormState) => SiteFormState) => void
  namePlaceholder: string
}) {
  return (
    <>
      <TextFieldRoot>
        <TextFieldInput
          class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={props.draft.name}
          onInput={(e) =>
            props.setDraft((d) => ({
              ...d,
              name: (e.target as HTMLInputElement).value,
            }))
          }
          placeholder={props.namePlaceholder}
        />
      </TextFieldRoot>
      <div class="flex gap-2">
        <MiniSelect
          options={PURPOSE_OPTIONS}
          value={
            PURPOSE_OPTIONS.find((o) => o.value === props.draft.purpose) ??
            PURPOSE_OPTIONS[0]
          }
          onChange={(opt) => {
            const purpose = opt.value
            const template =
              purpose === 'login' ? 30 : purpose === 'answer' ? 31 : 17
            props.setDraft((d) => ({ ...d, purpose, template }))
          }}
        />
        <MiniSelect
          options={TEMPLATE_OPTIONS}
          value={
            TEMPLATE_OPTIONS.find((o) => o.value === props.draft.template) ??
            TEMPLATE_OPTIONS[0]
          }
          onChange={(opt) =>
            props.setDraft((d) => ({ ...d, template: opt.value }))
          }
        />
        <NumberFieldRoot
          value={props.draft.counter}
          minValue={1}
          onChange={(v) =>
            props.setDraft((d) => ({
              ...d,
              counter: Math.max(1, Number(v)),
            }))
          }
        >
          <NumberFieldInput
            class="tap w-16 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            title="Spectre counter"
          />
        </NumberFieldRoot>
      </div>
      <Show when={props.draft.purpose === 'answer'}>
        <TextFieldRoot>
          <TextFieldInput
            class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
            value={props.draft.answer}
            onInput={(e) =>
              props.setDraft((d) => ({
                ...d,
                answer: (e.target as HTMLInputElement).value,
              }))
            }
            placeholder="security question, e.g. childhood pet"
          />
        </TextFieldRoot>
      </Show>
    </>
  )
}
