export default function ErrorScreen(props: {
  message: string
  onRetry: () => void
}) {
  return (
    <div data-screen="error" class="flex flex-col gap-2">
      <p class="text-sm text-red-400">{props.message}</p>
      <button class="text-sm text-teal-spectre" onClick={() => props.onRetry()}>
        Retry unlock
      </button>
    </div>
  )
}
