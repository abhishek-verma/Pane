export type Env = Record<string, string | undefined>

export interface ResolveVariantOptions {
  variantId?: string
  provider?: string
  model?: string
  apiKey?: string
  apiKeyEnv?: string
  baseUrl?: string
  supportsImages?: boolean
  env?: Env
  requireApiKey?: boolean
}

export interface EvalVariant {
  id: string
  agent: {
    provider: string
    model: string
    apiKey?: string
    baseUrl?: string
    supportsImages?: boolean
  }
  publicMetadata: {
    id: string
    agent: {
      provider: string
      model: string
      baseUrlHost?: string
      supportsImages?: boolean
      apiKeyConfigured: boolean
      apiKeyEnv?: string
    }
  }
}

function boolFromEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

function hostFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).host
  } catch {
    return undefined
  }
}

function isEnvName(value: string | undefined): boolean {
  return !!value && /^[A-Z][A-Z0-9_]*$/.test(value)
}

/** Resolves one model/backend variant from CLI values first, then env. */
export function resolveVariant(
  options: ResolveVariantOptions = {},
): EvalVariant {
  const env = options.env ?? process.env
  const provider =
    options.provider ?? env.EVAL_AGENT_PROVIDER ?? 'openai-compatible'
  const model = options.model ?? env.EVAL_AGENT_MODEL

  if (provider === 'claude-code') {
    const id = options.variantId ?? env.EVAL_VARIANT ?? 'claude-code'
    return {
      id,
      agent: {
        provider,
        model: model ?? '',
      },
      publicMetadata: {
        id,
        agent: {
          provider,
          model: model || 'default',
          apiKeyConfigured: false,
        },
      },
    }
  }

  const id = options.variantId ?? env.EVAL_VARIANT ?? 'default'
  const apiKey = options.apiKey ?? env.EVAL_AGENT_API_KEY
  const apiKeyEnv =
    options.apiKeyEnv ?? (options.apiKey ? undefined : 'EVAL_AGENT_API_KEY')
  const baseUrl = options.baseUrl ?? env.EVAL_AGENT_BASE_URL
  const supportsImages =
    options.supportsImages ?? boolFromEnv(env.EVAL_AGENT_SUPPORTS_IMAGES)

  if (!model) {
    throw new Error('EVAL_AGENT_MODEL is required')
  }
  if (options.requireApiKey && !apiKey) {
    throw new Error('EVAL_AGENT_API_KEY is required')
  }

  const publicApiKeyEnv =
    options.apiKeyEnv ?? (isEnvName(apiKey) ? apiKey : apiKeyEnv)

  return {
    id,
    agent: {
      provider,
      model,
      apiKey,
      baseUrl,
      supportsImages,
    },
    publicMetadata: {
      id,
      agent: {
        provider,
        model,
        baseUrlHost: hostFromUrl(baseUrl),
        supportsImages,
        apiKeyConfigured: !!apiKey,
        apiKeyEnv: publicApiKeyEnv,
      },
    },
  }
}
