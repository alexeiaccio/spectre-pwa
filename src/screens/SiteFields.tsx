import { For, Show } from 'solid-js'
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
      <input
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
      <div class="flex gap-2">
        <select
          class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={props.draft.purpose}
          onChange={(e) => {
            const purpose = (e.target as HTMLSelectElement)
              .value as Site['purpose']
            const template =
              purpose === 'login' ? 30 : purpose === 'answer' ? 31 : 17
            props.setDraft((d) => ({ ...d, purpose, template }))
          }}
        >
          <option value="password">password</option>
          <option value="login">login name</option>
          <option value="answer">security answer</option>
        </select>
        <select
          class="tap rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          value={props.draft.template}
          onChange={(e) =>
            props.setDraft((d) => ({
              ...d,
              template: Number((e.target as HTMLSelectElement).value),
            }))
          }
        >
          <For each={Object.entries(TEMPLATES)}>
            {([label, id]) => <option value={id}>{label}</option>}
          </For>
        </select>
        <input
          class="tap w-16 rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100"
          type="number"
          min={1}
          value={props.draft.counter}
          onInput={(e) =>
            props.setDraft((d) => ({
              ...d,
              counter: Math.max(
                1,
                Number((e.target as HTMLInputElement).value),
              ),
            }))
          }
          placeholder="count"
          title="Spectre counter"
        />
      </div>
      <Show when={props.draft.purpose === 'answer'}>
        <input
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
      </Show>
    </>
  )
}
