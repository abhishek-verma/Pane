import { CHATGPT_PROVIDER_DISPLAY_NAME } from './provider-display-names'
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
} from './provider-selection'
import type { LlmProviderConfig } from './types'

/** Applies the v3 provider display-name compatibility migration. */
export function migrateLlmProvidersToV3(
  providers: LlmProviderConfig[] | null,
): LlmProviderConfig[] | null {
  if (!providers) return providers
  return normalizeProviderNames(providers)
}

const DEEPSEEK_V4_CONTEXT_WINDOW = 1_000_000

/** Bumps stale DeepSeek V4 context windows (template used to ship 64k). */
export function migrateLlmProvidersToV4(
  providers: LlmProviderConfig[] | null,
): LlmProviderConfig[] | null {
  if (!providers) return providers
  return providers.map((provider) => {
    if (
      provider.type === 'deepseek' &&
      (provider.modelId === 'deepseek-v4-flash' ||
        provider.modelId === 'deepseek-v4-pro') &&
      provider.contextWindow < DEEPSEEK_V4_CONTEXT_WINDOW
    ) {
      return {
        ...provider,
        contextWindow: DEEPSEEK_V4_CONTEXT_WINDOW,
        updatedAt: Date.now(),
      }
    }
    return provider
  })
}

/** Applies compatibility renames for stored provider display names. */
export function normalizeProviderNames(
  providers: LlmProviderConfig[],
): LlmProviderConfig[] {
  return providers.map((provider) => {
    if (
      provider.id === DEFAULT_PROVIDER_ID &&
      provider.type === 'browseros' &&
      provider.name !== DEFAULT_PROVIDER_NAME
    ) {
      return {
        ...provider,
        name: DEFAULT_PROVIDER_NAME,
      }
    }
    if (
      provider.type === 'chatgpt-pro' &&
      isLegacyChatGPTProviderName(provider.name)
    ) {
      return {
        ...provider,
        name: CHATGPT_PROVIDER_DISPLAY_NAME,
      }
    }
    return provider
  })
}

function isLegacyChatGPTProviderName(name: string): boolean {
  return /^ChatGPT Plus\/Pro(?: \([^@\s()]+@[^@\s()]+\))?$/.test(name)
}
