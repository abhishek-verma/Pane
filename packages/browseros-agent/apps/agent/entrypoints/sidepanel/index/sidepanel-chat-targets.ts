import type {
  HarnessAdapterDescriptor,
  HarnessAgent,
  HarnessAgentAdapter,
} from '@/entrypoints/app/agents/agent-harness-types'
import type { LlmProviderConfig, ProviderType } from '@/lib/llm-providers/types'

export type SidepanelTargetKind = 'llm' | 'acp'

export type SidepanelChatTarget =
  | {
      kind: 'llm'
      id: string
      name: string
      type: ProviderType
      provider: LlmProviderConfig
    }
  | {
      kind: 'acp'
      id: string
      name: string
      type: 'acp'
      agentId: string
      adapter: HarnessAgentAdapter
      adapterName: string
      modelId: string
      modelLabel: string
      modelControl: HarnessAdapterDescriptor['modelControl']
      recommended?: boolean
      reasoningEffort: string
      reasoningEffortLabel?: string
    }

export type SidepanelChatTargetSelection = Pick<
  SidepanelChatTarget,
  'kind' | 'id'
>

interface BuildSidepanelChatTargetsInput {
  providers: LlmProviderConfig[]
  adapters: HarnessAdapterDescriptor[]
  agents?: HarnessAgent[]
}

interface ResolveSidepanelChatTargetInput {
  targets: SidepanelChatTarget[]
  defaultProviderId: string
  selection?: SidepanelChatTargetSelection | null
}

interface SidepanelChatTargetSelectionWriter {
  setValue(value: SidepanelChatTargetSelection | null): Promise<void>
}

interface SidepanelChatTargetSelectionReader {
  getValue(): Promise<SidepanelChatTargetSelection | null>
}

type SidepanelChatTargetSelectionStore = SidepanelChatTargetSelectionReader &
  SidepanelChatTargetSelectionWriter

let sidepanelChatTargetSelectionStorage:
  | SidepanelChatTargetSelectionStore
  | undefined

export function buildSidepanelChatTargets({
  providers,
  adapters,
  agents = [],
}: BuildSidepanelChatTargetsInput): SidepanelChatTarget[] {
  return [
    ...providers.map(toLlmTarget),
    ...agents.map((agent) => toAcpTargetForAgent(agent, adapters)),
  ]
}

function toAcpTargetForAgent(
  agent: HarnessAgent,
  adapters: HarnessAdapterDescriptor[],
): SidepanelChatTarget {
  const adapter = adapters.find((entry) => entry.id === agent.adapter)
  const modelId = agent.modelId ?? adapter?.defaultModelId ?? 'default'
  const reasoningEffort =
    agent.reasoningEffort ?? adapter?.defaultReasoningEffort ?? 'medium'
  const model = adapter?.models.find((entry) => entry.id === modelId)
  const reasoning = adapter?.reasoningEfforts.find(
    (effort) => effort.id === reasoningEffort,
  )

  return {
    kind: 'acp',
    id: agent.id,
    name: agent.name,
    type: 'acp',
    agentId: agent.id,
    adapter: agent.adapter,
    adapterName: adapter?.name ?? formatAdapterName(agent.adapter),
    modelId,
    modelLabel: model?.label ?? modelId,
    modelControl: adapter?.modelControl ?? 'best-effort',
    recommended: model?.recommended,
    reasoningEffort,
    reasoningEffortLabel: reasoning?.label,
  }
}

function formatAdapterName(adapter: HarnessAgentAdapter): string {
  if (adapter === 'claude') return 'Claude Code'
  if (adapter === 'codex') return 'Codex'
  if (adapter === 'openclaw') return 'OpenClaw'
  return adapter
}

export function resolveSidepanelChatTarget({
  targets,
  defaultProviderId,
  selection,
}: ResolveSidepanelChatTargetInput): SidepanelChatTarget | undefined {
  if (selection) {
    const selected = targets.find(
      (target) => target.kind === selection.kind && target.id === selection.id,
    )
    if (selected) return selected
  }

  return (
    targets.find(
      (target) => target.kind === 'llm' && target.id === defaultProviderId,
    ) ?? targets.find((target) => target.kind === 'llm')
  )
}

export function toLlmProviderConfig(
  target: SidepanelChatTarget | undefined,
): LlmProviderConfig | undefined {
  return target?.kind === 'llm' ? target.provider : undefined
}

export async function persistSidepanelChatTargetSelection(
  target: SidepanelChatTarget | undefined,
  store?: SidepanelChatTargetSelectionWriter,
): Promise<void> {
  const targetStore = store ?? (await getSidepanelChatTargetSelectionStorage())
  await targetStore.setValue(
    target ? { kind: target.kind, id: target.id } : null,
  )
}

export async function loadSidepanelChatTargetSelection(
  store?: SidepanelChatTargetSelectionReader,
): Promise<SidepanelChatTargetSelection | null> {
  const targetStore = store ?? (await getSidepanelChatTargetSelectionStorage())
  return targetStore.getValue()
}

function toLlmTarget(provider: LlmProviderConfig): SidepanelChatTarget {
  return {
    kind: 'llm',
    id: provider.id,
    name: provider.name,
    type: provider.type,
    provider,
  }
}

async function getSidepanelChatTargetSelectionStorage(): Promise<SidepanelChatTargetSelectionStore> {
  if (sidepanelChatTargetSelectionStorage) {
    return sidepanelChatTargetSelectionStorage
  }

  const { storage } = await import('@wxt-dev/storage')
  sidepanelChatTargetSelectionStorage =
    storage.defineItem<SidepanelChatTargetSelection | null>(
      'local:sidepanel-chat-target-selection',
      { fallback: null },
    )
  return sidepanelChatTargetSelectionStorage
}
