import { splitProps } from 'solid-js'
import type { ComponentProps, ParentComponent } from 'solid-js'

/** Muted description text (`text-sm text-slate-400`). */
export const Text: ParentComponent<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <p {...rest} class={`text-sm text-slate-400 ${local.class ?? ''}`} />
  )
}

/** Small muted hint (`text-xs text-slate-500`). */
export const Hint: ParentComponent<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <p {...rest} class={`text-xs text-slate-500 ${local.class ?? ''}`} />
  )
}

/** Error text (`text-sm text-red-400`). */
export const ErrorText: ParentComponent<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class'])
  return <p {...rest} class={`text-sm text-red-400 ${local.class ?? ''}`} />
}

/** Accent/pending text (`text-sm text-teal-spectre`). */
export const Accent: ParentComponent<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <p {...rest} class={`text-sm text-teal-spectre ${local.class ?? ''}`} />
  )
}
