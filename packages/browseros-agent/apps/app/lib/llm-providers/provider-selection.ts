import { DEFAULT_PROVIDER_DISPLAY_NAME } from '@/lib/constants/product'
import { productFeatures } from '@/lib/constants/product-features'
import type { LlmProviderConfig } from './types'

export const DEFAULT_PROVIDER_ID = 'browseros'
export const DEFAULT_PROVIDER_NAME = DEFAULT_PROVIDER_DISPLAY_NAME

export function getInitialDefaultProviderId(): string {
  return productFeatures.hostedInference ? DEFAULT_PROVIDER_ID : ''
}

/** Returns true when the built-in hosted provider cannot be removed. */
export function isProtectedHostedProviderId(providerId: string): boolean {
  return productFeatures.hostedInference && providerId === DEFAULT_PROVIDER_ID
}

/** Resolves the persisted default id, repairing stale values to the first provider. */
export function resolveDefaultProviderId(
  providers: LlmProviderConfig[],
  defaultProviderId: string | null | undefined,
): string {
  if (
    defaultProviderId &&
    providers.some((provider) => provider.id === defaultProviderId)
  ) {
    return defaultProviderId
  }
  return providers[0]?.id ?? getInitialDefaultProviderId()
}

/** Resolves the provider selected by the persisted default id. */
export function resolveSelectedProvider(
  providers: LlmProviderConfig[],
  defaultProviderId: string,
): LlmProviderConfig | null {
  return (
    providers.find((provider) => provider.id === defaultProviderId) ??
    providers[0] ??
    null
  )
}
