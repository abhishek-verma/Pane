import { toast } from 'sonner'
import type { PendingDeviceCode } from '@/lib/llm-providers/authenticate-provider'
import type { OAuthProviderFlowConfig } from '@/lib/llm-providers/oauth-providers'
import { CHATGPT_PROVIDER_DISPLAY_NAME } from '@/lib/llm-providers/provider-display-names'
import { getProviderTemplate } from '@/lib/llm-providers/providerTemplates'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import { track } from '@/lib/metrics/track'
import { useProviderAuthentication } from './provider-authentication.hooks'

export interface OAuthProviderFlowReturn {
  status: { authenticated: boolean; email?: string } | null
  disconnect: () => Promise<void>
  startOAuthFlow: (agentServerUrl: string | undefined) => Promise<void>
  pendingDeviceCode: PendingDeviceCode | null
  clearDeviceCode: () => void
}

export interface SaveOAuthProviderInput {
  config: OAuthProviderFlowConfig
  status: { email?: string }
  saveProvider: (provider: LlmProviderConfig) => Promise<void> | void
  now?: number
}

/** Persists the local provider row created after an OAuth account authenticates. */
export async function saveOAuthProviderFromStatus({
  config,
  status,
  saveProvider,
  now = Date.now(),
}: SaveOAuthProviderInput): Promise<LlmProviderConfig> {
  const template = getProviderTemplate(config.providerType)
  const providerName =
    config.providerType === 'chatgpt-pro'
      ? CHATGPT_PROVIDER_DISPLAY_NAME
      : `${config.displayName}${status.email ? ` (${status.email})` : ''}`
  const provider: LlmProviderConfig = {
    id: `${config.providerType}-${now}`,
    type: config.providerType,
    name: providerName,
    modelId: template?.defaultModelId ?? '',
    supportsImages: template?.supportsImages ?? true,
    contextWindow: template?.contextWindow ?? 128000,
    temperature: 0.2,
    createdAt: now,
    updatedAt: now,
  }
  if (config.providerType === 'chatgpt-pro') {
    provider.reasoningEffort = 'medium'
    provider.reasoningSummary = 'auto'
  }

  await saveProvider(provider)
  return provider
}

/** Quick setup adds a provider only after the shared sign-in flow completes. */
export function useOAuthProviderFlow(
  config: OAuthProviderFlowConfig,
  _providers: LlmProviderConfig[],
  saveProvider: (provider: LlmProviderConfig) => Promise<void> | void,
): OAuthProviderFlowReturn {
  const authentication = useProviderAuthentication(config, async (status) => {
    await saveOAuthProviderFromStatus({ config, status, saveProvider })
    track(config.completedEvent, { email: status.email })
    toast.success(`${config.displayName} Connected`)
  })

  async function startOAuthFlow(agentServerUrl: string | undefined) {
    if (!agentServerUrl) {
      toast.error('Server not available', {
        description: 'Cannot start sign-in without server connection.',
      })
      return
    }
    try {
      track(config.startedEvent)
      await authentication.start(agentServerUrl)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      toast.error(`Failed to connect ${config.displayName}`, {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
  return {
    status: authentication.status,
    disconnect: authentication.disconnect,
    startOAuthFlow,
    pendingDeviceCode: authentication.pendingDeviceCode,
    clearDeviceCode: authentication.cancel,
  }
}
