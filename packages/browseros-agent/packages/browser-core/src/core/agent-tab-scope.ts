import { AsyncLocalStorage } from 'node:async_hooks'

export interface AgentTabScope {
  agentScope: string
  defaultWindowId?: number
  defaultTabGroupId?: string
}

// A shared BrowserSession serves concurrent tasks. Async-local state preserves
// ownership through `run` scripts without mutating session-wide defaults.
const scope = new AsyncLocalStorage<AgentTabScope>()
export const currentAgentTabScope = () => scope.getStore()
export const withAgentTabScope = <T>(value: AgentTabScope, work: () => T): T =>
  scope.run(value, work)
