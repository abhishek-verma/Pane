import { resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { denyBrowserosPrivateBashCommand } from './bash-path-policy'
import {
  getTerminalSessionCwd,
  notifyTerminalSessionRun,
  readSessionForBash,
  resolveSessionCd,
  type TerminalSessionRecord,
  updateTerminalSessionCwd,
} from './sessions'
import {
  DEFAULT_BASH_TIMEOUT,
  executeWithMetrics,
  resolveWorkspaceRoot,
  toModelOutput,
  truncateTail,
} from './utils'
import { isDenied, type Workspace } from './workspace'

const TOOL_NAME = 'filesystem_bash'

function getShellArgs(): [string, string] {
  if (process.platform === 'win32') return ['cmd.exe', '/c']
  return [process.env.SHELL || '/bin/sh', '-c']
}

async function resolveBashCwd(
  workspace: Workspace,
  sessionId?: string,
): Promise<
  { cwd: string; session: TerminalSessionRecord | null } | { error: string }
> {
  const root = await resolveWorkspaceRoot(workspace.root)
  if (!sessionId) {
    return { cwd: root, session: null }
  }

  const session = await readSessionForBash(workspace, sessionId)
  if (!session) {
    return { error: `Unknown terminal session: ${sessionId}` }
  }

  const sessionCwd = await getTerminalSessionCwd(workspace, sessionId)
  return {
    cwd: sessionCwd ? resolve(sessionCwd) : root,
    session,
  }
}

async function syncSessionAfterRun(
  workspace: Workspace,
  sessionId: string,
  session: TerminalSessionRecord,
  resolvedCwd: string,
  command: string,
  timedOut: boolean,
  exitCode: number,
): Promise<void> {
  const nextCwd = await resolveSessionCd(workspace, resolvedCwd, command)
  if (nextCwd !== resolvedCwd) {
    await updateTerminalSessionCwd(workspace, sessionId, nextCwd)
  }
  notifyTerminalSessionRun(
    workspace,
    session,
    command,
    timedOut ? -1 : exitCode,
  )
}

function formatCommandOutput(
  stdoutText: string,
  stderrText: string,
  exitCode: number,
  timedOut: boolean,
  timeoutSeconds: number,
): { text: string; isError?: boolean } {
  if (timedOut) {
    let output = stdoutText
    if (stderrText) output += (output ? '\n' : '') + stderrText
    const truncated = truncateTail(output)
    return {
      text: `Command timed out after ${timeoutSeconds}s\n\n${truncated.content}`,
      isError: true,
    }
  }

  let output = stdoutText
  if (stderrText) output += (output ? '\n' : '') + stderrText

  const truncated = truncateTail(output)
  let result = truncated.content
  if (truncated.truncated) {
    result = `(Output truncated. Showing last ${truncated.keptLines} of ${truncated.totalLines} lines)\n${result}`
  }

  if (exitCode !== 0) {
    result += `\n\n[Exit code: ${exitCode}]`
    return { text: result, isError: true }
  }

  return { text: result || '(no output)' }
}

export function createBashTool(workspace: Workspace) {
  return tool({
    description:
      'Execute a shell command in the workspace. Output is truncated to the last 2000 lines if too large. Pass sessionId to reuse a named terminal session (list with terminal_sessions). Cannot read private Pane state under ~/.browseros (use capture_*/context_*/memory_* instead). May require user approval.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      timeout: z
        .number()
        .optional()
        .describe(`Timeout in seconds (default: ${DEFAULT_BASH_TIMEOUT})`),
      sessionId: z
        .string()
        .optional()
        .describe('Reuse a named terminal session (cwd persists across calls)'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const denial = isDenied(params.command, workspace.terminalPolicy)
        if (denial.denied) {
          return {
            text: `Blocked by terminal policy: ${denial.reason}`,
            isError: true,
          }
        }
        const privateDenial = denyBrowserosPrivateBashCommand(params.command)
        if (privateDenial) {
          return { text: privateDenial, isError: true }
        }

        const cwdResult = await resolveBashCwd(workspace, params.sessionId)
        if ('error' in cwdResult) {
          return { text: cwdResult.error, isError: true }
        }

        const timeoutSeconds = params.timeout || DEFAULT_BASH_TIMEOUT
        const [shell, flag] = getShellArgs()
        const proc = Bun.spawn([shell, flag, params.command], {
          cwd: cwdResult.cwd,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env },
        })

        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          proc.kill()
        }, timeoutSeconds * 1000)

        const [stdoutText, stderrText] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        const exitCode = await proc.exited
        clearTimeout(timer)

        if (params.sessionId && cwdResult.session) {
          await syncSessionAfterRun(
            workspace,
            params.sessionId,
            cwdResult.session,
            cwdResult.cwd,
            params.command,
            timedOut,
            exitCode,
          )
        }

        return formatCommandOutput(
          stdoutText,
          stderrText,
          exitCode,
          timedOut,
          timeoutSeconds,
        )
      }),
    toModelOutput,
  })
}
