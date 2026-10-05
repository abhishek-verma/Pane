import {
  getModelsDevModels,
  type ModelsDevModel,
} from '../../lib/llm-providers/models-dev'
import type { ProviderType } from '../../lib/llm-providers/types'

export interface ModelInfo {
  modelId: string
  contextLength: number
  supportsImages?: boolean
  supportsReasoning?: boolean
  supportsToolCall?: boolean
}

const CUSTOM_PROVIDER_MODELS: Partial<Record<ProviderType, ModelInfo[]>> = {
  browseros: [{ modelId: 'browseros-auto', contextLength: 200000 }],
  'openai-compatible': [],
  ollama: [],
  'chatgpt-pro': [
    ...[
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ].map((modelId) => ({
      modelId,
      contextLength: 1050000,
      supportsImages: true,
      supportsReasoning: true,
      supportsToolCall: true,
    })),
  ],
  'qwen-code': [
    { modelId: 'coder-model', contextLength: 1000000 },
    { modelId: 'qwen3-coder-plus', contextLength: 1000000 },
    { modelId: 'qwen3-coder-flash', contextLength: 1000000 },
    { modelId: 'qwen3.5-plus', contextLength: 1000000 },
  ],
}

function fromModelsDevModel(m: ModelsDevModel): ModelInfo {
  return {
    modelId: m.id,
    contextLength: m.contextWindow,
    supportsImages: m.supportsImages,
    supportsReasoning: m.supportsReasoning,
    supportsToolCall: m.supportsToolCall,
  }
}

export function getModelsForProvider(
  providerType: ProviderType,
  catalogModels?: ModelsDevModel[],
): ModelInfo[] {
  if (catalogModels?.length) return catalogModels.map(fromModelsDevModel)
  const custom = CUSTOM_PROVIDER_MODELS[providerType]
  if (custom !== undefined) return custom

  return getModelsDevModels(providerType).map(fromModelsDevModel)
}

export function getModelContextLength(
  providerType: ProviderType,
  modelId: string,
): number | undefined {
  const models = getModelsForProvider(providerType)
  const model = models.find((m) => m.modelId === modelId)
  return model?.contextLength
}
