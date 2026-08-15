import { ErrorText } from '../components/ui/index.ts'

export default function ErrorScreen(props: {
  message: string
  onRetry: () => void
}) {
  return (
    <div data-screen="error" class="flex flex-col gap-2">
      <ErrorText>{props.message}</ErrorText>
      <button class="text-sm text-teal-spectre" onClick={() => props.onRetry()}>
        Retry unlock
      </button>
    </div>
  )
}
