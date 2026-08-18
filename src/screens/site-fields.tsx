import { Show } from 'solid-js'
import {
  Disclosure,
  Input,
  NumberField,
  Select,
} from '../components/ui/index.ts'
import type { Site } from '../lib/vault/schema.ts'

export const PURPOSE_LABEL: Record<Site['purpose'], string> = {
  password: 'password',
  login: 'login name',
  answer: 'security answer',
}

const TEMPLATES: Record<string, number> = {
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
  /** When true, the purpose/template/counter row hides behind a disclosure (add mode). */
  collapsible?: boolean
}) {
  const selectors = () => (
    <div class="flex items-stretch gap-2">
      <div class="min-w-0 flex-1">
        <Select
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
      </div>
      <div class="min-w-0 flex-1">
        <Select
          options={TEMPLATE_OPTIONS}
          value={
            TEMPLATE_OPTIONS.find((o) => o.value === props.draft.template) ??
            TEMPLATE_OPTIONS[0]
          }
          onChange={(opt) =>
            props.setDraft((d) => ({ ...d, template: opt.value }))
          }
        />
      </div>
      <NumberField
        value={props.draft.counter}
        minValue={1}
        title="Spectre counter"
        onChange={(v) =>
          props.setDraft((d) => ({
            ...d,
            counter: Math.max(1, v),
          }))
        }
      />
    </div>
  )

  return (
    <>
      <Input
        label="Site name"
        value={props.draft.name}
        onInput={(e) =>
          props.setDraft((d) => ({
            ...d,
            name: e.currentTarget.value,
          }))
        }
        placeholder={props.namePlaceholder}
      />
      <Show when={props.collapsible} fallback={selectors()}>
        <Disclosure label="More options">{selectors()}</Disclosure>
      </Show>
      <Show when={props.draft.purpose === 'answer'}>
        <Input
          label="Security question answer"
          value={props.draft.answer}
          onInput={(e) =>
            props.setDraft((d) => ({
              ...d,
              answer: e.currentTarget.value,
            }))
          }
          placeholder="security question, e.g. childhood pet"
        />
      </Show>
    </>
  )
}
