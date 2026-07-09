import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { replayToolOnServer } from '@/lib/trust/replay-tool'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'
import type { ActionLogEntry } from './useActionLog'

function formatReplayResult(output: unknown): string {
  if (output && typeof output === 'object') {
    if ('text' in output && typeof output.text === 'string') {
      return output.text
    }
    if ('content' in output && Array.isArray(output.content)) {
      return output.content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: string }).text ?? '')
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
  }
  return JSON.stringify(output, null, 2)
}

export function ActionLogReplayButton({ entry }: { entry: ActionLogEntry }) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const { selectedFolder } = useWorkspace()
  const [replaying, setReplaying] = useState(false)
  const [replayOutput, setReplayOutput] = useState<string | null>(null)
  const [replayError, setReplayError] = useState<string | null>(null)

  const canReplay =
    entry.consequenceClass !== 'read' &&
    Boolean(baseUrl) &&
    !urlLoading &&
    Boolean(selectedFolder?.path)

  const handleReplay = async () => {
    if (!baseUrl || !selectedFolder?.path) return

    setReplaying(true)
    setReplayError(null)
    setReplayOutput(null)

    try {
      const args = JSON.parse(entry.argsJson) as Record<string, unknown>
      const result = await replayToolOnServer(baseUrl, {
        toolName: entry.toolName,
        args,
        conversationId: entry.conversationId,
        userWorkingDir: selectedFolder.path,
        workspaceId: selectedFolder.id,
        bucketId: selectedFolder.bucketId ?? 'default',
      })
      setReplayOutput(
        `Decision: ${result.decision}\n\n${formatReplayResult(result.output)}`,
      )
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : 'Replay failed')
    } finally {
      setReplaying(false)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!canReplay || replaying}
        onClick={() => void handleReplay()}
      >
        {replaying ? 'Replaying…' : 'Replay'}
      </Button>
      {!selectedFolder?.path && (
        <p className="text-muted-foreground text-xs">
          Select a workspace to replay tool calls.
        </p>
      )}
      {replayError && <p className="text-destructive text-xs">{replayError}</p>}
      {replayOutput && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
          {replayOutput}
        </pre>
      )}
    </div>
  )
}
