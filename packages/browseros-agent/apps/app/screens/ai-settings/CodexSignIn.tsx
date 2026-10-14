import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { withRequestDeadline } from '@/lib/browseros/request-deadline'

export function CodexSignIn({
  serverUrl,
  onSuccess,
}: {
  serverUrl: string | null | undefined
  onSuccess: () => void
}) {
  const request = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function signIn() {
    if (!serverUrl || request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setMessage(null)
    try {
      await withRequestDeadline(
        async (signal) => {
          const response = await agentFetch(
            `${serverUrl}/acpx/probe/codex/sign-in`,
            { method: 'POST', signal },
          )
          const body = (await response.json()) as { error?: string }
          if (!response.ok || body.error)
            throw new Error(body.error ?? 'Codex sign-in did not complete.')
        },
        { signal: controller.signal, timeoutMs: 310_000 },
      )
      if (!controller.signal.aborted) {
        setMessage('Signed in to Codex.')
        onSuccess()
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Codex sign-in did not complete.',
        )
    } finally {
      if (request.current === controller) {
        request.current = null
        setPending(false)
      }
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!serverUrl || pending}
          onClick={signIn}
        >
          {pending ? 'Waiting for sign-in…' : 'Sign in to Codex'}
        </Button>
        {pending && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => request.current?.abort()}
          >
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs" role="status">
        {pending
          ? 'Finish signing in in the browser window. Models will refresh when you return.'
          : (message ??
            'Already signed in? Your existing Codex account is used automatically.')}
      </p>
    </div>
  )
}
