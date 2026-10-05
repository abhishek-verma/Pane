/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import modelCatalog from '@browseros/shared/model-catalog-data.json'
import type { AgentAdapter, AgentAdapterDescriptor } from '../agent-types'

export const AGENT_ADAPTER_CATALOG: AgentAdapterDescriptor[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    defaultModelId: 'haiku',
    defaultReasoningEffort: 'medium',
    modelControl: 'best-effort',
    models: [
      { id: 'opus', label: 'Opus (latest)' },
      { id: 'sonnet', label: 'Sonnet (latest)' },
      { id: 'haiku', label: 'Haiku (latest)', recommended: true },
      ...modelCatalog.anthropic.models.map((model) => ({
        id: model.id,
        label: model.name,
      })),
    ],
    reasoningEfforts: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium', recommended: true },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra high' },
      { id: 'max', label: 'Max' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    defaultModelId: 'gpt-6-astra',
    defaultReasoningEffort: 'medium',
    modelControl: 'best-effort',
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', recommended: true },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
    ],
    reasoningEfforts: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium', recommended: true },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra high' },
      { id: 'max', label: 'Max' },
      { id: 'ultra', label: 'Ultra' },
    ],
  },
]

export function getAgentAdapterDescriptor(
  adapter: AgentAdapter,
): AgentAdapterDescriptor | null {
  return AGENT_ADAPTER_CATALOG.find((entry) => entry.id === adapter) ?? null
}

export function isAgentAdapter(value: unknown): value is AgentAdapter {
  return value === 'claude' || value === 'codex'
}

export function resolveDefaultModelId(adapter: AgentAdapter): string {
  return getAgentAdapterDescriptor(adapter)?.defaultModelId ?? 'default'
}

export function resolveDefaultReasoningEffort(adapter: AgentAdapter): string {
  return getAgentAdapterDescriptor(adapter)?.defaultReasoningEffort ?? 'medium'
}

export function isSupportedAgentModel(
  adapter: AgentAdapter,
  modelId: string | undefined,
): boolean {
  if (!modelId || modelId === 'default') return true
  const descriptor = getAgentAdapterDescriptor(adapter)
  return Boolean(descriptor?.models.some((model) => model.id === modelId))
}

export function isSupportedReasoningEffort(
  adapter: AgentAdapter,
  effort: string | undefined,
): boolean {
  if (!effort) return true
  const descriptor = getAgentAdapterDescriptor(adapter)
  return Boolean(
    descriptor?.reasoningEfforts.some((option) => option.id === effort),
  )
}
