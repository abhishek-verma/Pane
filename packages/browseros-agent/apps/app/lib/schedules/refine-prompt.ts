import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { resolveStoredChatProvider } from '@/lib/llm-providers/storage'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'

const resolveProvider = async (
  providerId?: string,
): Promise<LlmProviderConfig> => {
  const provider = await resolveStoredChatProvider(providerId, true)
  if (!provider) {
    throw new Error(
      'No AI provider configured. Add one in Settings → AI & Agents.',
    )
  }
  return provider
}

interface RefinePromptResponse {
  success: boolean
  refined?: string
  message?: string
}

export async function refinePrompt(params: {
  prompt: string
  name: string
  providerId?: string
}): Promise<string> {
  const agentServerUrl = await getAgentServerUrl()
  const provider = await resolveProvider(params.providerId)

  const response = await fetch(`${agentServerUrl}/refine-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      name: params.name,
      provider: provider.type,
      model: provider.modelId ?? 'default',
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      resourceName: provider.resourceName,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      region: provider.region,
      sessionToken: provider.sessionToken,
    }),
  })

  if (!response.ok) {
    const errorData = (await response
      .json()
      .catch(() => null)) as RefinePromptResponse | null
    throw new Error(errorData?.message ?? `Request failed: ${response.status}`)
  }

  const data = (await response.json()) as RefinePromptResponse
  if (!data.success || !data.refined) {
    throw new Error(data.message ?? 'Failed to refine prompt')
  }

  return data.refined
}
