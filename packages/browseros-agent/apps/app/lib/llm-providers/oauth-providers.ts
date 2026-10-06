import {
  CHATGPT_PRO_OAUTH_COMPLETED_EVENT,
  CHATGPT_PRO_OAUTH_DISCONNECTED_EVENT,
  CHATGPT_PRO_OAUTH_STARTED_EVENT,
  GITHUB_COPILOT_OAUTH_COMPLETED_EVENT,
  GITHUB_COPILOT_OAUTH_DISCONNECTED_EVENT,
  GITHUB_COPILOT_OAUTH_STARTED_EVENT,
  QWEN_CODE_OAUTH_COMPLETED_EVENT,
  QWEN_CODE_OAUTH_DISCONNECTED_EVENT,
  QWEN_CODE_OAUTH_STARTED_EVENT,
} from '@/lib/constants/analyticsEvents'
import type { ClientAuthConfig } from './client-oauth'
import { CHATGPT_PROVIDER_DISPLAY_NAME } from './provider-display-names'
import type { ProviderType } from './types'

export interface OAuthProviderFlowConfig {
  providerType: ProviderType
  displayName: string
  startedEvent: string
  completedEvent: string
  disconnectedEvent: string
  clientAuth?: ClientAuthConfig
}

export const OAUTH_PROVIDERS_CONFIG = {
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
} satisfies Record<string, OAuthProviderFlowConfig>

export type OAuthProviderType = keyof typeof OAUTH_PROVIDERS_CONFIG

export function isOAuthProviderType(
  type: ProviderType,
): type is OAuthProviderType {
  return Object.hasOwn(OAUTH_PROVIDERS_CONFIG, type)
}
