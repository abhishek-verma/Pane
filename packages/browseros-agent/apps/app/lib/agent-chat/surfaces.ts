import { cn } from '@/lib/utils'

/** Left-rail trace shell — tool evidence, quiet activity rows. */
export function agentTraceClass(
  kind: 'default' | 'browser' | 'error' = 'default',
  className?: string,
) {
  return cn(
    'agent-trace',
    kind === 'browser' && 'agent-trace-browser',
    kind === 'error' && 'agent-trace-error',
    className,
  )
}

/** Compact code / diff peek inside a trace (no nested card). */
export function agentPeekClass(className?: string) {
  return cn('agent-peek', className)
}
