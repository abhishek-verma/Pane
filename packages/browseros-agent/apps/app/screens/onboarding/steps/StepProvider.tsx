/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Feature } from '@/lib/browseros/capabilities'
import {
  CHATGPT_PRO_OAUTH_COMPLETED_EVENT,
  CHATGPT_PRO_OAUTH_DISCONNECTED_EVENT,
  CHATGPT_PRO_OAUTH_STARTED_EVENT,
  GITHUB_COPILOT_OAUTH_COMPLETED_EVENT,
  GITHUB_COPILOT_OAUTH_DISCONNECTED_EVENT,
  GITHUB_COPILOT_OAUTH_STARTED_EVENT,
  ONBOARDING_STEP_COMPLETED_EVENT,
  QWEN_CODE_OAUTH_COMPLETED_EVENT,
  QWEN_CODE_OAUTH_DISCONNECTED_EVENT,
  QWEN_CODE_OAUTH_STARTED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { CHATGPT_PROVIDER_DISPLAY_NAME } from '@/lib/llm-providers/provider-display-names'
import { visibleProviderTemplates } from '@/lib/llm-providers/provider-visibility'
import {
  type ProviderTemplate,
  providerTemplates,
} from '@/lib/llm-providers/providerTemplates'
import {
  type LlmProviderConfig,
  REMOTE_HERMES_PROVIDER_TYPE,
} from '@/lib/llm-providers/types'
import { track } from '@/lib/metrics/track'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { useCapabilities } from '@/modules/browseros/capabilities.hooks'
import { useLlmProviders } from '@/modules/llm-providers/llm-providers.hooks'
import {
  type OAuthProviderFlowConfig,
  useOAuthProviderFlow,
} from '@/modules/llm-providers/oauth-provider-flow.hooks'
import { DeviceCodeDialog } from '@/screens/ai-settings/DeviceCodeDialog'
import { NewProviderDialog } from '@/screens/ai-settings/NewProviderDialog'
import { ProviderTemplateCard } from '@/screens/ai-settings/ProviderTemplateCard'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepProviderProps {
  direction: StepDirection
  onContinue: () => void
}

const OAUTH_PROVIDERS_CONFIG: Record<string, OAuthProviderFlowConfig> = {
  'chatgpt-pro': {
    providerType: 'chatgpt-pro',
    displayName: CHATGPT_PROVIDER_DISPLAY_NAME,
    startedEvent: CHATGPT_PRO_OAUTH_STARTED_EVENT,
    completedEvent: CHATGPT_PRO_OAUTH_COMPLETED_EVENT,
    disconnectedEvent: CHATGPT_PRO_OAUTH_DISCONNECTED_EVENT,
  },
  'github-copilot': {
    providerType: 'github-copilot',
    displayName: 'GitHub Copilot',
    startedEvent: GITHUB_COPILOT_OAUTH_STARTED_EVENT,
    completedEvent: GITHUB_COPILOT_OAUTH_COMPLETED_EVENT,
    disconnectedEvent: GITHUB_COPILOT_OAUTH_DISCONNECTED_EVENT,
    clientAuth: {
      deviceCodeEndpoint: 'https://github.com/login/device/code',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      clientId: 'Ov23li8tweQw6odWQebz',
      scopes: 'read:user',
      requiresPKCE: false,
      contentType: 'json',
    },
  },
  'qwen-code': {
    providerType: 'qwen-code',
    displayName: 'Qwen Code',
    startedEvent: QWEN_CODE_OAUTH_STARTED_EVENT,
    completedEvent: QWEN_CODE_OAUTH_COMPLETED_EVENT,
    disconnectedEvent: QWEN_CODE_OAUTH_DISCONNECTED_EVENT,
    clientAuth: {
      deviceCodeEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      scopes: 'openid profile email model.completion',
      requiresPKCE: true,
      contentType: 'form',
    },
  },
}

const ONBOARDING_TEMPLATE_ORDER = [
  'chatgpt-pro',
  'anthropic',
  'openai',
  'google',
  'ollama',
  'openrouter',
  'github-copilot',
  'lmstudio',
] as const

export const StepProvider = ({ direction, onContinue }: StepProviderProps) => {
  const { providers, saveProvider, isLoading } = useLlmProviders()
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const { supports } = useCapabilities()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [templateValues, setTemplateValues] = useState<
    Partial<LlmProviderConfig> | undefined
  >()

  const chatgptPro = useOAuthProviderFlow(
    OAUTH_PROVIDERS_CONFIG['chatgpt-pro'],
    providers,
    saveProvider,
  )
  const copilot = useOAuthProviderFlow(
    OAUTH_PROVIDERS_CONFIG['github-copilot'],
    providers,
    saveProvider,
  )
  const qwenCode = useOAuthProviderFlow(
    OAUTH_PROVIDERS_CONFIG['qwen-code'],
    providers,
    saveProvider,
  )

  const activeDeviceCode =
    chatgptPro.pendingDeviceCode ??
    copilot.pendingDeviceCode ??
    qwenCode.pendingDeviceCode

  const oauthFlows: Record<
    string,
    { startOAuthFlow: (url: string | undefined) => Promise<void> }
  > = {
    'chatgpt-pro': { startOAuthFlow: chatgptPro.startOAuthFlow },
    'github-copilot': { startOAuthFlow: copilot.startOAuthFlow },
    'qwen-code': { startOAuthFlow: qwenCode.startOAuthFlow },
  }

  const templates = visibleProviderTemplates(providerTemplates, supports)
    .filter((template) => {
      if (template.id === REMOTE_HERMES_PROVIDER_TYPE) return false
      if (template.id === 'chatgpt-pro')
        return supports(Feature.CHATGPT_PRO_SUPPORT)
      if (template.id === 'github-copilot')
        return supports(Feature.GITHUB_COPILOT_SUPPORT)
      if (template.id === 'qwen-code')
        return supports(Feature.QWEN_CODE_SUPPORT)
      return true
    })
    .sort((a, b) => {
      const ai = ONBOARDING_TEMPLATE_ORDER.indexOf(
        a.id as (typeof ONBOARDING_TEMPLATE_ORDER)[number],
      )
      const bi = ONBOARDING_TEMPLATE_ORDER.indexOf(
        b.id as (typeof ONBOARDING_TEMPLATE_ORDER)[number],
      )
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    .slice(0, 8)

  const hasProvider = providers.length > 0

  const handleUseTemplate = (template: ProviderTemplate) => {
    const oauthFlow = oauthFlows[template.id]
    if (oauthFlow) {
      void oauthFlow.startOAuthFlow(agentServerUrl ?? undefined)
      return
    }

    setTemplateValues({
      type: template.id,
      name: template.name,
      baseUrl: template.defaultBaseUrl,
      modelId: template.defaultModelId,
      supportsImages: template.supportsImages,
      contextWindow: template.contextWindow,
      temperature: 0.2,
    })
    setDialogOpen(true)
  }

  const handleContinue = () => {
    if (!hasProvider) return
    track(ONBOARDING_STEP_COMPLETED_EVENT, {
      step: 2,
      step_name: 'provider',
      provider_count: providers.length,
      provider_types: providers.map((p) => p.type),
    })
    onContinue()
  }

  return (
    <StepTransition direction={direction}>
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center space-y-5 px-2 py-4">
        <div className="space-y-2 text-center">
          <h2 className="font-bold text-2xl tracking-tight">Add a model</h2>
          <p className="text-muted-foreground text-sm">
            Pane needs at least one provider to chat. Use a subscription you
            already pay for, paste an API key, or point at a local runtime —
            your call.
          </p>
        </div>

        {hasProvider && (
          <div className="rounded-lg border border-[var(--accent-orange)]/40 bg-[var(--accent-orange)]/5 px-4 py-3">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Check className="size-4 text-[var(--accent-orange)]" />
              Ready to continue
            </div>
            <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
              {providers.map((provider) => (
                <li key={provider.id}>
                  {provider.name}
                  <span className="text-muted-foreground/70">
                    {' '}
                    · {provider.modelId || provider.type}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid max-h-[280px] gap-2 overflow-y-auto sm:grid-cols-2">
          {templates.map((template) => (
            <ProviderTemplateCard
              key={template.id}
              template={template}
              onUseTemplate={handleUseTemplate}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setTemplateValues(undefined)
              setDialogOpen(true)
            }}
          >
            <Plus className="size-4" />
            Custom provider
          </Button>
          <Button
            type="button"
            disabled={!hasProvider || isLoading}
            className="bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange)]/90"
            onClick={handleContinue}
          >
            Continue
          </Button>
        </div>

        <NewProviderDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialValues={templateValues}
          onSave={saveProvider}
        />
        <DeviceCodeDialog
          deviceCode={activeDeviceCode}
          onClose={() => {
            chatgptPro.clearDeviceCode()
            copilot.clearDeviceCode()
            qwenCode.clearDeviceCode()
          }}
        />
      </div>
    </StepTransition>
  )
}
