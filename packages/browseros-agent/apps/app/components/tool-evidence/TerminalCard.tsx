import { Check, Copy } from 'lucide-react'
import { type FC, useState } from 'react'
import {
  TERMINAL_OUTPUT_CLAMP_CHARS,
  type ToolEvidence,
} from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from './ToolStatusIcon'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const CopyChip: FC<{ label: string; text: string }> = ({ label, text }) => {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      onClick={async (e) => {
        e.stopPropagation()
        const ok = await copyText(text)
        if (ok) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }
      }}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? 'Copied' : label}
    </button>
  )
}

function formatExit(code: number | undefined): string | null {
  if (code === undefined) return null
  return `exit ${code}`
}

export const TerminalCard: FC<{ evidence: ToolEvidence }> = ({ evidence }) => {
  const terminal = evidence.terminal
  if (!terminal) return null

  const command = terminal.command
  const output = [terminal.stdout, terminal.stderr].filter(Boolean).join('\n')
  const clamped =
    output.length > TERMINAL_OUTPUT_CLAMP_CHARS
      ? `${output.slice(0, TERMINAL_OUTPUT_CLAMP_CHARS)}\n…`
      : output
  const exitLabel = formatExit(terminal.exitCode)
  const exitOk = terminal.exitCode === 0

  return (
    <div
      className={cn(
        'w-full rounded-md border border-border/60 bg-card/40 px-2.5 py-2',
        evidence.state === 'error' && 'border-destructive/40',
      )}
    >
      <div className="flex items-center gap-2">
        <ToolStatusIcon state={evidence.state} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {command ? `$ ${command}` : evidence.title}
        </span>
        {exitLabel ? (
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
              exitOk
                ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                : 'bg-destructive/15 text-destructive',
            )}
          >
            {exitLabel}
          </span>
        ) : null}
      </div>

      {evidence.errorText && evidence.state === 'error' ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
          {evidence.errorText}
        </p>
      ) : null}

      {clamped ? (
        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground leading-snug">
          {terminal.truncated ? (
            <span className="mb-1 block text-[10px] text-muted-foreground/80">
              Output truncated
            </span>
          ) : null}
          {clamped}
        </pre>
      ) : evidence.state === 'completed' ? (
        <p className="mt-1 text-[11px] text-muted-foreground">(no output)</p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <CopyChip label="Copy command" text={command} />
        <CopyChip label="Copy output" text={output} />
      </div>
    </div>
  )
}
