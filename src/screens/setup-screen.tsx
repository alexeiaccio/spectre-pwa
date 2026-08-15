import { createSignal, Show } from 'solid-js'
import { Button, Hint, Input, Text } from '../components/ui/index.ts'
import { useScreen } from '../lib/flow.ts'

/** `/setup` — first run. */
export default function SetupScreen() {
  const { api, navigate } = useScreen()
  const [code, setCode] = createSignal('')
  const noCode = () => code().trim().length === 0
  return (
    <div data-screen="setup" class="flex flex-col gap-4">
      <Text>
        First run — create your vault. Add a recovery code as your key in:
      </Text>
      <form
        class="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!noCode()) void api.vault.setup(code())
        }}
      >
        <Input
          label="Recovery code"
          value={code()}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          placeholder="recovery code"
          autocomplete="new-password"
        />
        <Button
          variant="primary"
          type="submit"
          disabled={noCode()}
        >
          Create vault with passkey
        </Button>
        <Show when={noCode()}>
          <Hint>Enter a recovery code first — it's the key to your vault.</Hint>
        </Show>
        <div class="flex flex-col gap-1">
          <Button
            variant="secondary"
            disabled={noCode()}
            onClick={() => void api.vault.setupRecoveryOnly(code())}
          >
            Create vault without a passkey
          </Button>
          <Hint>
            Use this in an installed PWA where Chrome can't create a platform
            passkey. You'll unlock with the recovery code; a passkey can be
            added later from a browser tab.
          </Hint>
        </div>
      </form>
      <button
        class="text-xs text-slate-500 underline hover:text-slate-300"
        onClick={() => navigate('/join')}
      >
        I have a vault on another device — join it
      </button>
    </div>
  )
}
