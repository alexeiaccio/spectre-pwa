import type { JSX } from '@solidjs/web'

/** Muted description text (`text-sm text-slate-400`). */
export function Text(props: { class?: string; children?: JSX.Element }) {
  return (
    <p class={`text-sm text-slate-400 ${props.class ?? ''}`}>
      {props.children}
    </p>
  )
}

/** Small muted hint (`text-xs text-slate-500`). */
export function Hint(props: { class?: string; children?: JSX.Element }) {
  return (
    <p class={`text-xs text-slate-500 ${props.class ?? ''}`}>
      {props.children}
    </p>
  )
}

/** Error text (`text-sm text-red-400`). */
export function ErrorText(props: { class?: string; children?: JSX.Element }) {
  return (
    <p class={`text-sm text-red-400 ${props.class ?? ''}`}>{props.children}</p>
  )
}

/** Accent/pending text (`text-sm text-teal-spectre`). */
export function Accent(props: { class?: string; children?: JSX.Element }) {
  return (
    <p class={`text-sm text-teal-spectre ${props.class ?? ''}`}>
      {props.children}
    </p>
  )
}
