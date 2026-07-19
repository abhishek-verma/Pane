import type { TerminalDetail } from './types'

const EXIT_CODE_RE = /\[Exit code:\s*(-?\d+)\]\s*$/
const TRUNCATED_RE = /^\(Output truncated\. Showing last \d+ of \d+ lines\)\n/

/**
 * Parse `filesystem_bash` tool output from apps/server filesystem/bash.ts:
 * - optional truncation preamble
 * - merged stdout+stderr body
 * - optional trailing `[Exit code: N]` when non-zero
 * - timeout: `Command timed out after Ns\n\n…` (no exit line)
 */
export function buildTerminalDetail(args: {
  input: Record<string, unknown>
  outputText: string
  isError: boolean
}): TerminalDetail {
  const command =
    typeof args.input.command === 'string' ? args.input.command : ''

  let text = args.outputText ?? ''
  let truncated = false
  if (TRUNCATED_RE.test(text)) {
    truncated = true
    text = text.replace(TRUNCATED_RE, '')
  }

  let exitCode: number | undefined
  const exitMatch = text.match(EXIT_CODE_RE)
  if (exitMatch) {
    exitCode = Number(exitMatch[1])
    text = text.slice(0, exitMatch.index).replace(/\n+$/, '')
  } else if (!args.isError && !/^Command timed out/i.test(text)) {
    exitCode = 0
  }

  const body = text === '(no output)' ? '' : text

  return {
    command,
    exitCode,
    stdout: body || undefined,
    truncated: truncated || undefined,
  }
}
