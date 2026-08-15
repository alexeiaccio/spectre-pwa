import { createSignal } from 'solid-js'
import { Button, Input, Text } from '../components/ui/index.ts'

export default function SetupScreen(props: {
  onSubmit: (code: string) => void
  onJoin: () => void
}) {
  const [code, setCode] = createSignal('')
  return (
    <div data-screen="setup" class="flex flex-col gap-4">
      <Text>
        First run — create your vault with a passkey. Add a recovery code as a
        second way in:
      </Text>
      <Input
        value={code()}
        onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        placeholder="recovery code"
      />
      <Button variant="primary" onClick={() => props.onSubmit(code())}>
        Create vault
      </Button>
      <button
        class="text-xs text-slate-500 underline hover:text-slate-300"
        onClick={() => props.onJoin()}
      >
        I have a vault on another device — join it
      </button>
    </div>
  )
}
