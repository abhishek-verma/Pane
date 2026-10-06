import {
  generateModelsData,
  type ModelsDevProvider,
  PROVIDER_MAP,
} from '@browseros/shared/model-catalog'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ProviderType } from '@/lib/llm-providers/types'
import { getModelsForProvider } from '@/screens/ai-settings/models'

// Public metadata only. Never send provider credentials to the catalog service.
export function useProviderModels(providerType: ProviderType) {
  const canRefresh = Object.values(PROVIDER_MAP).includes(providerType)
  const query = useQuery({
    queryKey: ['provider-model-catalog'],
    enabled: canRefresh,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const response = await fetch('https://models.dev/api.json', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        credentials: 'omit',
      })
      if (!response.ok) throw new Error('Model catalog unavailable')
      return generateModelsData(
        (await response.json()) as Record<string, ModelsDevProvider>,
      )
    },
  })
  const models = useMemo(
    () =>
      getModelsForProvider(providerType, query.data?.[providerType]?.models),
    [providerType, query.data],
  )
  return {
    models,
    canRefresh,
    refetch: query.refetch,
    isFetching: query.isFetching,
    isError: query.isError,
  }
}
