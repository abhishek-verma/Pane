import {
  probeAcpAgent,
  type ServerAcpxProbeInput,
  type ServerAcpxProbeResult,
} from '../../../api/services/acpx-probe/probeAgent'
import type { AgentAdapter, AgentAdapterDescriptor } from '../agent-types'
import { getAgentAdapterDescriptor } from './catalog'

/** Account/runtime discovery, with a last-known-good cache and offline fallback. */
export class AgentModelDiscovery {
  private cache = new Map<
    AgentAdapter,
    { value: AgentAdapterDescriptor; expires: number }
  >()
  private pending = new Map<AgentAdapter, Promise<AgentAdapterDescriptor>>()

  constructor(
    private readonly options: Pick<
      ServerAcpxProbeInput,
      'resourcesDir' | 'browserosDir'
    > = {},
    private readonly probe: (
      input: ServerAcpxProbeInput,
    ) => Promise<ServerAcpxProbeResult> = probeAcpAgent,
    private readonly now = Date.now,
  ) {}

  /** Listing must not wait for a CLI process; creation can await get(). */
  getCached(adapter: AgentAdapter): AgentAdapterDescriptor {
    const value =
      this.cache.get(adapter)?.value ?? getAgentAdapterDescriptor(adapter)
    if (!value) throw new Error(`Unknown adapter: ${adapter}`)
    void this.get(adapter).catch(() => {})
    return value
  }

  get(adapter: AgentAdapter): Promise<AgentAdapterDescriptor> {
    const cached = this.cache.get(adapter)
    if (cached && cached.expires > this.now())
      return Promise.resolve(cached.value)
    const pending = this.pending.get(adapter)
    if (pending) return pending
    const request = this.refresh(adapter).finally(() =>
      this.pending.delete(adapter),
    )
    this.pending.set(adapter, request)
    return request
  }

  private async refresh(
    adapter: AgentAdapter,
  ): Promise<AgentAdapterDescriptor> {
    const fallback =
      this.cache.get(adapter)?.value ?? getAgentAdapterDescriptor(adapter)
    if (!fallback) throw new Error(`Unknown adapter: ${adapter}`)
    let value = fallback
    let success = false
    try {
      const result = await this.probe({
        ...this.options,
        agentId: adapter,
        timeoutMs: 8_000,
      })
      if (!result.error && result.models.length > 0) {
        const models = result.models
          .filter((model) => model.id.trim())
          .map((model) => ({
            id: model.id,
            label: model.name || model.id,
          }))
        if (!models[0]) throw new Error('Empty model discovery')
        const defaultModelId = models.some(
          (model) => model.id === fallback.defaultModelId,
        )
          ? fallback.defaultModelId
          : models[0].id
        const efforts = result.reasoning?.values
        const defaultEffort = result.reasoning?.defaultValue
        value = {
          ...fallback,
          modelControl: result.supportsConfigOption
            ? 'runtime-supported'
            : 'best-effort',
          defaultModelId,
          models: models.map((model) => ({
            ...model,
            recommended: model.id === defaultModelId,
          })),
          ...(efforts?.length
            ? {
                defaultReasoningEffort:
                  defaultEffort && efforts.includes(defaultEffort)
                    ? defaultEffort
                    : efforts.includes('medium')
                      ? 'medium'
                      : (efforts[0] ?? fallback.defaultReasoningEffort),
                reasoningEfforts: efforts.map((id) => ({ id, label: id })),
              }
            : {}),
        }
        success = true
      }
    } catch {
      // Missing CLI, auth, timeout, and network failures keep settings usable.
    }
    this.cache.set(adapter, {
      value,
      expires: this.now() + (success ? 300_000 : 30_000),
    })
    return value
  }
}
