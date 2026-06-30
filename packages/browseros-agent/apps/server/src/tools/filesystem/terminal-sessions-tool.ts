import { tool } from 'ai'
import { z } from 'zod'
import { listTerminalSessions } from './sessions'
import { executeWithMetrics, toModelOutput } from './utils'
import type { Workspace } from './workspace'

const TOOL_NAME = 'terminal_sessions'

export function createTerminalSessionsTool(workspace: Workspace) {
  return tool({
    description:
      'List reusable terminal sessions for the active workspace (read-only).',
    inputSchema: z.object({}),
    execute: () =>
      executeWithMetrics(TOOL_NAME, async () => {
        const sessions = await listTerminalSessions(workspace)
        if (sessions.length === 0) {
          return { text: 'No terminal sessions for this workspace.' }
        }
        const lines = sessions.map(
          (s) =>
            `- ${s.name} (${s.id}): cwd=${s.cwd}, created=${new Date(s.createdAt).toISOString()}`,
        )
        return { text: lines.join('\n') }
      }),
    toModelOutput,
  })
}
