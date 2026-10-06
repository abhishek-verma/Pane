import type { LlmProviderConfig, ProviderType } from './types'

type AuthenticationKind =
  | 'api-key'
  | 'optional-api-key'
  | 'azure'
  | 'aws'
  | 'oauth'
  | 'cli'
  | 'custom-agent'
  | 'managed'

/** Exhaustive so new providers must declare their setup requirements. */
export const PROVIDER_AUTH_KIND = {
  anthropic: 'api-key',
  openai: 'api-key',
  google: 'api-key',
  openrouter: 'api-key',
  moonshot: 'api-key',
  cerebras: 'api-key',
  deepseek: 'api-key',
  'openai-compatible': 'optional-api-key',
  ollama: 'optional-api-key',
  lmstudio: 'optional-api-key',
  azure: 'azure',
  bedrock: 'aws',
  'chatgpt-pro': 'oauth',
  'github-copilot': 'oauth',
  'qwen-code': 'oauth',
  codex: 'cli',
  'claude-code': 'cli',
  'acp-custom': 'custom-agent',
  browseros: 'managed',
  'remote-hermes': 'managed',
} satisfies Record<ProviderType, AuthenticationKind>

export function isAcpProviderType(type: ProviderType | undefined): boolean {
  return !!type && ['cli', 'custom-agent'].includes(PROVIDER_AUTH_KIND[type])
}

export function isProviderTestable(
  input: Partial<LlmProviderConfig> & { type: ProviderType },
): boolean {
  if (!input.modelId?.trim()) return false
  const kind = PROVIDER_AUTH_KIND[input.type]
  if (kind === 'managed') return input.type === 'browseros'
  if (kind === 'cli' || kind === 'oauth') return true
  if (kind === 'custom-agent')
    return !!(input.acpAgentId?.trim() && input.acpCommand?.trim())
  if (kind === 'aws')
    return !!(input.accessKeyId && input.secretAccessKey && input.region)
  if (kind === 'azure')
    return !!((input.resourceName || input.baseUrl) && input.apiKey)
  return !!input.baseUrl && (kind === 'optional-api-key' || !!input.apiKey)
}

const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const

/** ACP's "default" is absence of an override, not a concrete API effort. */
export function normalizeReasoningEffort(
  value?: string,
): LlmProviderConfig['reasoningEffort'] {
  return REASONING_EFFORTS.find((effort) => effort === value)
}
