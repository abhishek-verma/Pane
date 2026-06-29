import { byokGuideUrl, productRepositoryUrl } from '@/lib/constants/productUrls'
import { getModelsDevProvider } from './models-dev'
import { CHATGPT_PROVIDER_DISPLAY_NAME } from './provider-display-names'
import type { ProviderType } from './types'

/**
 * Provider template for quick setup
 * @public
 */
export interface ProviderTemplate {
  id: ProviderType
  name: string
  defaultBaseUrl: string
  defaultModelId: string
  supportsImages: boolean
  contextWindow: number
  setupGuideUrl?: string
  apiKeyUrl?: string
}

function enrichTemplate(
  providerId: ProviderType,
  overrides: {
    defaultModelId: string
    defaultBaseUrl?: string
    apiKeyUrl?: string
    setupGuideUrl?: string
  },
): ProviderTemplate {
  const provider = getModelsDevProvider(providerId)
  const model = provider?.models.find((m) => m.id === overrides.defaultModelId)

  return {
    id: providerId,
    name: provider?.name ?? providerId,
    defaultBaseUrl: overrides.defaultBaseUrl ?? provider?.api ?? '',
    defaultModelId: overrides.defaultModelId,
    supportsImages: model?.supportsImages ?? true,
    contextWindow: model?.contextWindow ?? 128000,
    ...(overrides.apiKeyUrl && { apiKeyUrl: overrides.apiKeyUrl }),
    ...(overrides.setupGuideUrl && { setupGuideUrl: overrides.setupGuideUrl }),
  }
}

/**
 * Available provider templates for quick setup
 * @public
 */
export const providerTemplates: ProviderTemplate[] = [
  {
    id: 'remote-hermes',
    name: 'Remote Hermes',
    defaultBaseUrl: '',
    defaultModelId: 'default',
    supportsImages: false,
    contextWindow: 200000,
  },
  {
    id: 'chatgpt-pro',
    name: CHATGPT_PROVIDER_DISPLAY_NAME,
    defaultBaseUrl: 'https://chatgpt.com/backend-api',
    defaultModelId: 'gpt-5.5',
    supportsImages: true,
    contextWindow: 1050000,
    setupGuideUrl: productRepositoryUrl,
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    defaultBaseUrl: 'https://api.githubcopilot.com',
    defaultModelId: 'gpt-5-mini',
    supportsImages: true,
    contextWindow: 128000,
    setupGuideUrl: productRepositoryUrl,
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    defaultBaseUrl: 'https://portal.qwen.ai/v1',
    defaultModelId: 'coder-model',
    supportsImages: true,
    contextWindow: 1000000,
    setupGuideUrl: productRepositoryUrl,
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModelId: 'kimi-k2.5',
    supportsImages: true,
    contextWindow: 200000,
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    setupGuideUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  enrichTemplate('openai', {
    defaultModelId: 'gpt-5',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    setupGuideUrl: byokGuideUrl,
  }),
  {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    defaultBaseUrl: '',
    defaultModelId: '',
    supportsImages: true,
    contextWindow: 128000,
  },
  enrichTemplate('anthropic', {
    defaultModelId: 'claude-sonnet-4-6',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    setupGuideUrl: byokGuideUrl,
  }),
  enrichTemplate('google', {
    defaultModelId: 'gemini-2.5-flash',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    setupGuideUrl: byokGuideUrl,
  }),
  {
    id: 'ollama',
    name: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModelId: 'llama3.2',
    supportsImages: false,
    contextWindow: 128000,
    setupGuideUrl: byokGuideUrl,
  },
  enrichTemplate('openrouter', {
    defaultModelId: 'anthropic/claude-sonnet-4.5',
    apiKeyUrl: 'https://openrouter.ai/keys',
    setupGuideUrl: byokGuideUrl,
  }),
  enrichTemplate('lmstudio', {
    defaultModelId: 'openai/gpt-oss-20b',
    defaultBaseUrl: 'http://localhost:1234/v1',
    setupGuideUrl: byokGuideUrl,
  }),
  enrichTemplate('azure', {
    defaultModelId: '',
    apiKeyUrl:
      'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',
  }),
  enrichTemplate('bedrock', {
    defaultModelId: 'anthropic.claude-sonnet-4-6',
    setupGuideUrl:
      'https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html',
  }),
  {
    id: 'cerebras',
    name: 'Cerebras',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    defaultModelId: 'llama-3.3-70b',
    supportsImages: false,
    contextWindow: 128000,
    apiKeyUrl: 'https://cloud.cerebras.ai/platform/org/api-keys',
    setupGuideUrl: 'https://inference-docs.cerebras.ai/introduction',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModelId: 'deepseek-v4-flash',
    supportsImages: false,
    contextWindow: 64000,
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    setupGuideUrl: 'https://api-docs.deepseek.com/',
  },
]

/**
 * Provider type options for select dropdowns
 * @public
 */
export const providerTypeOptions: { value: ProviderType; label: string }[] = [
  { value: 'remote-hermes', label: 'Remote Hermes' },
  { value: 'chatgpt-pro', label: CHATGPT_PROVIDER_DISPLAY_NAME },
  { value: 'github-copilot', label: 'GitHub Copilot' },
  { value: 'qwen-code', label: 'Qwen Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'moonshot', label: 'Moonshot AI' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'google', label: 'Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'azure', label: 'Azure' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'browseros', label: 'Pane' },
]

/**
 * Get provider template by type
 * @public
 */
export const getProviderTemplate = (
  type: ProviderType,
): ProviderTemplate | undefined => {
  return providerTemplates.find((t) => t.id === type)
}

/**
 * Default base URLs for each provider type
 * Auto-fills when user selects a provider type
 */
const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  'remote-hermes': '',
  'chatgpt-pro': 'https://chatgpt.com/backend-api',
  'github-copilot': 'https://api.githubcopilot.com',
  'qwen-code': 'https://portal.qwen.ai/v1',
  codex: '',
  'claude-code': '',
  'acp-custom': '',
  moonshot: 'https://api.moonshot.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  'openai-compatible': '',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  azure: '',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  bedrock: '',
  browseros: '',
}

/**
 * Get default base URL for a provider type
 * @public
 */
export const getDefaultBaseUrlForProviders = (type: ProviderType): string => {
  return DEFAULT_BASE_URLS[type] || ''
}
