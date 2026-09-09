import type { LlmProviderConfig, ProviderType } from './types'

const localRuntimeProviderTypes: ReadonlySet<ProviderType> = new Set([
  'codex',
  'claude-code',
])

/** Identifies provider configs backed by local CLIs instead of HTTP endpoints. */
export function isLocalRuntimeProviderType(type: ProviderType): boolean {
  return localRuntimeProviderTypes.has(type)
}

/**
 * Identifies provider configs that can be sent to the generic chat routes.
 * ACP-backed types (claude-code, codex, acp-custom) are chat-capable: the
 * agent server resolves them to an ACP LanguageModelV2 inside streamText.
 */
export function isChatProviderType(_type: ProviderType): boolean {
  return true
}

/** Finds an exact provider ID only when it is compatible with chat routes. */
export function findChatProviderById(
  providers: LlmProviderConfig[],
  providerId?: string | null,
): LlmProviderConfig | null {
  if (!providerId) return null
  const provider = providers.find((candidate) => candidate.id === providerId)
  return provider && isChatProviderType(provider.type) ? provider : null
}

/**
 * Saved providers are always testable except acp-custom missing a spawn command:
 * acpx's built-in registry resolves claude-code / codex commands, but a custom
 * agent has no fallback so the probe would fail with spawn_failed.
 */
export function canTestProvider(provider: LlmProviderConfig): boolean {
  if (provider.type === 'acp-custom') {
    return Boolean(provider.acpAgentId && provider.acpCommand)
  }
  return true
}

/** Resolves a provider compatible with Pane's local `/chat` server. */
export function resolveChatProvider(
  providers: LlmProviderConfig[],
  preferredProviderId?: string | null,
): LlmProviderConfig | null {
  const chatProviders = providers.filter((provider) =>
    isChatProviderType(provider.type),
  )
  if (preferredProviderId) {
    const preferred = findChatProviderById(chatProviders, preferredProviderId)
    if (preferred) return preferred
  }
  return chatProviders[0] ?? null
}

/**
 * Legacy names retained for callers that historically requested a
 * "cloud-only" provider. Scheduled tasks and prompt refinement run against
 * Pane's local agent server, which supports ACP-backed providers just like
 * interactive chat, so local CLI providers must remain eligible.
 */
function findCloudChatProviderById(
  providers: LlmProviderConfig[],
  providerId?: string | null,
): LlmProviderConfig | null {
  if (!providerId) return null
  const provider = providers.find((candidate) => candidate.id === providerId)
  return provider && isChatProviderType(provider.type) ? provider : null
}

export function resolveCloudChatProvider(
  providers: LlmProviderConfig[],
  preferredProviderId?: string | null,
): LlmProviderConfig | null {
  const cloudProviders = providers.filter((provider) =>
    isChatProviderType(provider.type),
  )
  if (preferredProviderId) {
    const preferred = findCloudChatProviderById(
      cloudProviders,
      preferredProviderId,
    )
    if (preferred) return preferred
  }
  return cloudProviders[0] ?? null
}
