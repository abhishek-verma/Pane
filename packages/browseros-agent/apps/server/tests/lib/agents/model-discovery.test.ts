import { describe, expect, it } from 'bun:test'
import type { ServerAcpxProbeResult } from '../../../src/api/services/acpx-probe/probeAgent'
import { AgentModelDiscovery } from '../../../src/lib/agents/adapters/model-discovery'

const result: ServerAcpxProbeResult = {
  models: [{ id: 'future-model', name: 'Future model' }],
  reasoning: { values: ['low', 'high'], defaultValue: 'high' },
  supportsConfigOption: true,
  agentInfo: null,
  protocolVersion: 1,
}

describe('agent model discovery', () => {
  it('returns immediately on cold and expired caches while a slow probe is pending', async () => {
    let time = 0
    let calls = 0
    let deferred = Promise.withResolvers<ServerAcpxProbeResult>()
    const discovery = new AgentModelDiscovery(
      {},
      () => {
        calls++
        return deferred.promise
      },
      () => time,
    )

    // These synchronous reads complete before the probe is resolved.
    expect(discovery.getCached('codex').defaultModelId).toBe('gpt-6-astra')
    expect(discovery.getCached('codex').defaultModelId).toBe('gpt-6-astra')
    expect(calls).toBe(1)
    deferred.resolve(result)
    await discovery.get('codex')
    expect(discovery.getCached('codex').defaultModelId).toBe('future-model')

    time = 300_001
    deferred = Promise.withResolvers<ServerAcpxProbeResult>()
    expect(discovery.getCached('codex').defaultModelId).toBe('future-model')
    expect(calls).toBe(2)
    deferred.resolve({ ...result, models: [{ id: 'next-model' }] })
    await discovery.get('codex')
    expect(discovery.getCached('codex').defaultModelId).toBe('next-model')
  })

  it('uses runtime models and efforts, caches and deduplicates concurrent requests', async () => {
    let calls = 0
    let time = 0
    const discovery = new AgentModelDiscovery(
      {},
      async () => {
        calls++
        return result
      },
      () => time,
    )
    const [a, b] = await Promise.all([
      discovery.get('codex'),
      discovery.get('codex'),
    ])
    expect(a).toBe(b)
    expect(calls).toBe(1)
    expect(a.defaultModelId).toBe('future-model')
    expect(a.defaultReasoningEffort).toBe('high')
    expect(a.models.map((model) => model.id)).toEqual(['future-model'])
    expect(a.reasoningEfforts.map((effort) => effort.id)).toEqual([
      'low',
      'high',
    ])
    await discovery.get('codex')
    expect(calls).toBe(1)
    time = 300_001
    await discovery.get('codex')
    expect(calls).toBe(2)
  })

  it('keeps last-known-good models after refresh failure', async () => {
    let time = 0
    const discovery = new AgentModelDiscovery(
      {},
      async () => {
        if (time) throw new Error('offline')
        return result
      },
      () => time,
    )
    const first = await discovery.get('claude')
    time = 300_001
    expect(await discovery.get('claude')).toEqual(first)
  })

  it('uses bundled models when discovery is empty or reports an auth error', async () => {
    for (const response of [
      { ...result, models: [] },
      { ...result, error: { code: 'auth_required', message: 'Sign in' } },
    ]) {
      const discovery = new AgentModelDiscovery({}, async () => response)
      const descriptor = await discovery.get('codex')
      expect(descriptor.defaultModelId).toBe('gpt-6-astra')
      expect(descriptor.modelControl).toBe('best-effort')
    }
  })
})
