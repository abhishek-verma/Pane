import { describe, expect, it } from 'bun:test'
import type {
  HarnessAdapterDescriptor,
  HarnessAgent,
} from '@/entrypoints/app/agents/agent-harness-types'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import {
  buildSidepanelChatTargets,
  persistSidepanelChatTargetSelection,
  resolveSidepanelChatTarget,
  type SidepanelChatTargetSelection,
  toLlmProviderConfig,
} from './sidepanel-chat-targets'

const timestamp = 1000

const providers: LlmProviderConfig[] = [
  {
    id: 'browseros',
    type: 'browseros',
    name: 'BrowserOS',
    baseUrl: 'https://api.browseros.com/v1',
    modelId: 'browseros-auto',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'anthropic-sonnet',
    type: 'anthropic',
    name: 'Anthropic Sonnet',
    modelId: 'claude-sonnet-4-6',
    apiKey: 'sk-ant',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

const adapters: HarnessAdapterDescriptor[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    defaultModelId: 'haiku',
    defaultReasoningEffort: 'medium',
    modelControl: 'best-effort',
    models: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku', recommended: true },
    ],
    reasoningEfforts: [
      { id: 'medium', label: 'Medium', recommended: true },
      { id: 'high', label: 'High' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    defaultModelId: 'gpt-5.5',
    defaultReasoningEffort: 'medium',
    modelControl: 'runtime-supported',
    models: [{ id: 'gpt-5.5', label: 'GPT-5.5', recommended: true }],
    reasoningEfforts: [{ id: 'medium', label: 'Medium', recommended: true }],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    defaultModelId: 'default',
    defaultReasoningEffort: 'medium',
    modelControl: 'best-effort',
    models: [],
    reasoningEfforts: [
      { id: 'medium', label: 'Medium', recommended: true },
      { id: 'high', label: 'High' },
    ],
  },
]

const agents: HarnessAgent[] = [
  {
    id: 'agent-codex',
    name: 'Review Bot',
    adapter: 'codex',
    modelId: 'gpt-5.5',
    reasoningEffort: 'medium',
    permissionMode: 'approve-all',
    sessionKey: 'agent:agent-codex:main',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'agent-openclaw',
    name: 'Research Claw',
    adapter: 'openclaw',
    modelId: 'default',
    reasoningEffort: 'high',
    permissionMode: 'approve-all',
    sessionKey: 'agent:agent-openclaw:main',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

describe('buildSidepanelChatTargets', () => {
  it('returns LLM targets plus one ACP target per persisted harness agent', () => {
    const targets = buildSidepanelChatTargets({ providers, adapters, agents })

    expect(targets.map((target) => target.id)).toEqual([
      'browseros',
      'anthropic-sonnet',
      'agent-codex',
      'agent-openclaw',
    ])
  })

  it('does not emit catalog-only ACP targets without persisted agents', () => {
    const targets = buildSidepanelChatTargets({
      providers,
      adapters,
      agents: [],
    })

    expect(targets.map((target) => target.id)).toEqual([
      'browseros',
      'anthropic-sonnet',
    ])
  })

  it('uses the created OpenClaw agent name instead of a generic adapter target', () => {
    const targets = buildSidepanelChatTargets({ providers, adapters, agents })
    const openclaw = targets.find((target) => target.id === 'agent-openclaw')

    expect(openclaw).toMatchObject({
      kind: 'acp',
      id: 'agent-openclaw',
      agentId: 'agent-openclaw',
      adapter: 'openclaw',
      adapterName: 'OpenClaw',
      modelId: 'default',
      modelLabel: 'default',
      name: 'Research Claw',
      modelControl: 'best-effort',
      reasoningEffort: 'high',
    })
  })

  it('preserves adapter metadata for created agent targets', () => {
    const targets = buildSidepanelChatTargets({ providers, adapters, agents })
    const codex = targets.find((target) => target.id === 'agent-codex')

    expect(codex).toMatchObject({
      kind: 'acp',
      agentId: 'agent-codex',
      adapter: 'codex',
      adapterName: 'Codex',
      modelId: 'gpt-5.5',
      modelLabel: 'GPT-5.5',
      modelControl: 'runtime-supported',
      recommended: true,
      reasoningEffort: 'medium',
      reasoningEffortLabel: 'Medium',
    })
  })

  it('still returns LLM targets when agents and adapters are unavailable', () => {
    expect(
      buildSidepanelChatTargets({ providers, adapters: [], agents: [] }),
    ).toEqual([
      {
        kind: 'llm',
        id: 'browseros',
        name: 'BrowserOS',
        type: 'browseros',
        provider: providers[0],
      },
      {
        kind: 'llm',
        id: 'anthropic-sonnet',
        name: 'Anthropic Sonnet',
        type: 'anthropic',
        provider: providers[1],
      },
    ])
  })
})

describe('resolveSidepanelChatTarget', () => {
  it('resolves selected LLM targets back to their provider config', () => {
    const targets = buildSidepanelChatTargets({ providers, adapters, agents })
    const resolved = resolveSidepanelChatTarget({
      targets,
      defaultProviderId: 'browseros',
      selection: { kind: 'llm', id: 'anthropic-sonnet' },
    })

    expect(resolved?.kind).toBe('llm')
    expect(toLlmProviderConfig(resolved)?.modelId).toBe('claude-sonnet-4-6')
  })

  it('falls back to the current default LLM provider when a persisted ACP target is stale', () => {
    const targets = buildSidepanelChatTargets({
      providers,
      adapters,
      agents: [],
    })

    expect(
      resolveSidepanelChatTarget({
        targets,
        defaultProviderId: 'anthropic-sonnet',
        selection: { kind: 'acp', id: 'agent-codex' },
      }),
    ).toMatchObject({
      kind: 'llm',
      id: 'anthropic-sonnet',
    })
  })

  it('falls back when an old catalog-style ACP target id is persisted', () => {
    const targets = buildSidepanelChatTargets({ providers, adapters, agents })

    expect(
      resolveSidepanelChatTarget({
        targets,
        defaultProviderId: 'anthropic-sonnet',
        selection: { kind: 'acp', id: 'acp:codex:gpt-5.5:medium' },
      }),
    ).toMatchObject({
      kind: 'llm',
      id: 'anthropic-sonnet',
    })
  })
})

describe('persistSidepanelChatTargetSelection', () => {
  it('stores only target identity and does not mutate LLM provider arrays', async () => {
    let savedSelection: SidepanelChatTargetSelection | null = null
    const originalProviders = providers.map((provider) => ({ ...provider }))
    const targets = buildSidepanelChatTargets({ providers, adapters, agents })
    const target = targets.find((candidate) => candidate.id === 'agent-codex')

    await persistSidepanelChatTargetSelection(target, {
      setValue: async (value) => {
        savedSelection = value
      },
    })

    expect(savedSelection as SidepanelChatTargetSelection | null).toEqual({
      kind: 'acp',
      id: 'agent-codex',
    })
    expect(providers).toEqual(originalProviders)
  })
})
