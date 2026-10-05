export interface ModelsDevModel {
  id: string
  name: string
  family?: string
  attachment: boolean
  reasoning: boolean
  tool_call: boolean
  structured_output?: boolean
  modalities: { input: string[]; output: string[] }
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
  limit: { context: number; output: number; input?: number }
  status?: string
  release_date: string
  last_updated: string
}

export interface ModelsDevProvider {
  id: string
  name: string
  npm: string
  api?: string
  doc: string
  env: string[]
  models: Record<string, ModelsDevModel>
}

export interface OutputModel {
  id: string
  name: string
  contextWindow: number
  maxOutput: number
  supportsImages: boolean
  supportsReasoning: boolean
  supportsToolCall: boolean
  inputCost?: number
  outputCost?: number
}

export interface OutputProvider {
  name: string
  api?: string
  doc: string
  models: OutputModel[]
}

export const PROVIDER_MAP: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  openrouter: 'openrouter',
  azure: 'azure',
  'amazon-bedrock': 'bedrock',
  lmstudio: 'lmstudio',
  moonshotai: 'moonshot',
  'github-copilot': 'github-copilot',
  cerebras: 'cerebras',
  deepseek: 'deepseek',
}

const NON_CHAT_MODEL_CLASS_TERMS = [
  'embedding',
  'image',
  'audio',
  'tts',
  'transcribe',
  'whisper',
  'moderation',
]

function isNonChatModelClass(model: ModelsDevModel): boolean {
  return [model.id, model.name, model.family ?? ''].some((value) => {
    const normalized = value.toLowerCase()

    return NON_CHAT_MODEL_CLASS_TERMS.some((term) => normalized.includes(term))
  })
}

/** Converts a models.dev model into the compact BrowserOS snapshot shape. */
export function transformModel(model: ModelsDevModel): OutputModel | null {
  if (
    typeof model.id !== 'string' ||
    !model.id.trim() ||
    typeof model.name !== 'string' ||
    !model.name.trim()
  )
    return null
  if (model.status === 'deprecated') return null
  if (isNonChatModelClass(model)) return null
  if (!model.modalities.input.includes('text')) return null
  if (!model.modalities.output.includes('text')) return null
  if (
    !Number.isFinite(model.limit.context) ||
    !Number.isFinite(model.limit.output)
  )
    return null
  if (model.limit.context <= 0 || model.limit.output <= 0) return null
  if (
    typeof model.reasoning !== 'boolean' ||
    typeof model.tool_call !== 'boolean'
  )
    return null

  const supportsImages = model.modalities.input.includes('image')

  return {
    id: model.id,
    name: model.name,
    contextWindow: model.limit.context,
    maxOutput: model.limit.output,
    supportsImages,
    supportsReasoning: model.reasoning,
    supportsToolCall: model.tool_call,
    ...(model.cost && {
      inputCost: model.cost.input,
      outputCost: model.cost.output,
    }),
  }
}

function assertUniqueModels(providerId: string, models: OutputModel[]) {
  const seen = new Set<string>()

  for (const model of models) {
    if (seen.has(model.id)) {
      throw new Error(`Duplicate model id for ${providerId}: ${model.id}`)
    }

    seen.add(model.id)
  }
}

/** Builds the BrowserOS provider snapshot from raw models.dev API data. */
export function generateModelsData(
  data: Record<string, ModelsDevProvider>,
  providerMap: Record<string, string> = PROVIDER_MAP,
): Record<string, OutputProvider> {
  const output: Record<string, OutputProvider> = {}

  for (const [modelsDevId, browserosId] of Object.entries(providerMap)) {
    const provider = data[modelsDevId]
    if (!provider) {
      throw new Error(`Provider not found in models.dev: ${modelsDevId}`)
    }

    const models = Object.values(provider.models)
      .map((model) => {
        const transformed = transformModel(model)

        return transformed
          ? { lastUpdated: model.last_updated, model: transformed }
          : null
      })
      .filter(
        (m): m is { lastUpdated: string; model: OutputModel } => m !== null,
      )
      .sort((a, b) => {
        const byLastUpdated = b.lastUpdated.localeCompare(a.lastUpdated)

        return byLastUpdated || a.model.id.localeCompare(b.model.id)
      })
      .map(({ model }) => model)

    if (models.length === 0)
      throw new Error(`No usable models for ${browserosId}`)
    assertUniqueModels(browserosId, models)

    output[browserosId] = {
      name: provider.name,
      ...(provider.api && { api: provider.api }),
      doc: provider.doc,
      models,
    }
  }

  return output
}
