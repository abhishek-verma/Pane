import type { RunStatus } from '@/lib/status'

export interface ActivityRow {
  id: string
  agentLabel: string
  /** Color the agent dot. Matches the per-agent color on AgentRow. */
  color: string
  status: Extract<
    RunStatus,
    'running' | 'blocked' | 'needs-human' | 'needs-ok' | 'done'
  > extends infer S
    ? S | 'allowed'
    : never
  action: string
  site?: string
  when: string
  /**
   * Run id used to route a done row's Replay link to
   * `/governance/audit/:runId/replay`. Only required on done rows.
   */
  runId?: string
  /** Total tool dispatches recorded against this tab. Surfaces as a badge. */
  toolCount?: number
  /** Short trail of recent tool names, e.g. `navigate -> snapshot -> act`. */
  trail?: string
}
