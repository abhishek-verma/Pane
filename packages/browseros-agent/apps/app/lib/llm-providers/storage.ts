import { storage } from '@wxt-dev/storage'
import { sessionStorage } from '@/lib/auth/sessionStorage'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { BROWSEROS_PREFS } from '@/lib/browseros/prefs'
import { productFeatures } from '@/lib/constants/product-features'
import {
  migrateLlmProvidersToV3,
  normalizeProviderNames,
} from './provider-name-normalization'
import {
  resolveChatProvider,
  resolveCloudChatProvider,
} from './provider-runtime'
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  getInitialDefaultProviderId,
} from './provider-selection'
import type { LlmProviderConfig, LlmProvidersBackup } from './types'
import { uploadLlmProvidersToGraphql } from './uploadLlmProvidersToGraphql'

export { DEFAULT_PROVIDER_ID } from './provider-selection'

export const providersStorage = storage.defineItem<LlmProviderConfig[]>(
  'local:llm-providers',
  {
    version: 3,
    migrations: {
      2: (
        providers: LlmProviderConfig[] | null,
      ): LlmProviderConfig[] | null => {
        if (!providers) return providers
        return providers.map((provider) => {
          if (
            provider.id === DEFAULT_PROVIDER_ID &&
            provider.type === 'browseros'
          ) {
            return { ...provider, contextWindow: 200000 }
          }
          return provider
        })
      },
      3: (
        providers: LlmProviderConfig[] | null,
      ): LlmProviderConfig[] | null => {
        return migrateLlmProvidersToV3(providers)
      },
    },
  },
)

/** Mirrors provider data into BrowserOS prefs without blocking local writes. */
async function backupToBrowserOS(backup: LlmProvidersBackup): Promise<void> {
  try {
    const adapter = getBrowserOSAdapter()
    await adapter.setPref(BROWSEROS_PREFS.PROVIDERS, JSON.stringify(backup))
  } catch {
    // BrowserOS API not available - ignore
  }
}

/** Sets up one-way sync of LLM providers to BrowserOS prefs. */
export function setupLlmProvidersBackupToBrowserOS(): () => void {
  const unsubscribe = providersStorage.watch(async (providers) => {
    if (providers) {
      const defaultProviderId = await defaultProviderIdStorage.getValue()
      await backupToBrowserOS({ defaultProviderId, providers })
    }
  })
  return unsubscribe
}

/** Uploads provider metadata for signed-in users when cloud sync is enabled. */
export async function syncLlmProviders(): Promise<void> {
  if (!productFeatures.cloudSync) return

  const providers = await providersStorage.getValue()
  if (!providers || providers.length === 0) return

  const session = await sessionStorage.getValue()
  const userId = session?.user?.id
  if (!userId) return

  await uploadLlmProvidersToGraphql(providers, userId)
}

/** Sets up one-way sync of LLM providers to the GraphQL backend. */
export function setupLlmProvidersSyncToBackend(): () => void {
  if (!productFeatures.cloudSync) {
    return () => {}
  }

  syncLlmProviders().catch(() => {})

  const unsubscribe = providersStorage.watch(async () => {
    try {
      await syncLlmProviders()
    } catch {
      // Sync failed silently - will retry on next storage change
    }
  })
  return unsubscribe
}

/** Returns provider configs after applying display-name compatibility fixes. */
export async function loadProviders(): Promise<LlmProviderConfig[]> {
  const providers = (await providersStorage.getValue()) || []
  let normalizedProviders = normalizeProviderNames(providers)

  if (!productFeatures.hostedInference) {
    normalizedProviders = normalizedProviders.filter(
      (provider) => provider.type !== 'browseros',
    )
  }

  // Keep storage consistent so every consumer sees the same provider name.
  if (
    normalizedProviders.some((provider, index) => provider !== providers[index])
  ) {
    await providersStorage.setValue(normalizedProviders)
  }

  return normalizedProviders
}

/** Creates the default BrowserOS provider configuration */
export function createDefaultBrowserOSProvider(): LlmProviderConfig {
  const timestamp = Date.now()
  return {
    id: DEFAULT_PROVIDER_ID,
    type: 'browseros',
    name: DEFAULT_PROVIDER_NAME,
    baseUrl: 'https://api.browseros.com/v1',
    modelId: 'browseros-auto',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** Creates the default providers configuration. */
export function createDefaultProvidersConfig(): LlmProviderConfig[] {
  return productFeatures.hostedInference
    ? [createDefaultBrowserOSProvider()]
    : []
}

/** Resolves the active chat provider from local storage. */
export async function resolveStoredChatProvider(
  preferredProviderId?: string | null,
  cloudOnly = false,
): Promise<LlmProviderConfig | null> {
  const providers = await loadProviders()
  const defaultProviderId = await defaultProviderIdStorage.getValue()
  const preferredId = preferredProviderId ?? defaultProviderId

  return cloudOnly
    ? resolveCloudChatProvider(providers, preferredId)
    : resolveChatProvider(providers, preferredId)
}

export const defaultProviderIdStorage = storage.defineItem<string>(
  'local:default-provider-id',
  {
    fallback: getInitialDefaultProviderId(),
  },
)
