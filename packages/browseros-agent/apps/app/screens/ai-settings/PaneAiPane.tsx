import { useQueryClient } from '@tanstack/react-query'
import { type FC, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useSessionInfo } from '@/lib/auth/sessionStorage'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { productFeatures } from '@/lib/constants/product-features'
import { GetProfileIdByUserIdDocument } from '@/lib/conversations/graphql/uploadConversationDocument'
import { getQueryKeyFromDocument } from '@/lib/graphql/getQueryKeyFromDocument'
import { OAUTH_PROVIDERS_CONFIG } from '@/lib/llm-providers/oauth-providers'
import type { ProviderTemplate } from '@/lib/llm-providers/providerTemplates'
import { testProvider } from '@/lib/llm-providers/testProvider'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import { track } from '@/lib/metrics/track'
import type { HarnessAgentAdapter } from '@/modules/agents/agent-harness-types'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { useGraphqlMutation } from '@/modules/graphql/graphql-mutation.hooks'
import { useGraphqlQuery } from '@/modules/graphql/graphql-query.hooks'
import { useLlmProviders } from '@/modules/llm-providers/llm-providers.hooks'
import { useOAuthProviderFlow } from '@/modules/llm-providers/oauth-provider-flow.hooks'
import { CodingAgentsList } from './CodingAgentsList'
import { ConfiguredProvidersList } from './ConfiguredProvidersList'
import { useCodingAgents } from './coding-agents.hooks'
import { DeviceCodeDialog } from './DeviceCodeDialog'
import { useDefaultChatTarget } from './default-chat-target.hooks'
import {
  DeleteRemoteLlmProviderDocument,
  GetRemoteLlmProvidersDocument,
} from './graphql/aiSettingsDocument'
import type { IncompleteProvider } from './IncompleteProviderCard'
import { IncompleteProvidersList } from './IncompleteProvidersList'
import { LlmProvidersHeader } from './LlmProvidersHeader'
import { McpPromoBanner } from './McpPromoBanner'
import { NewProviderDialog } from './NewProviderDialog'
import { ProviderTemplatesSection } from './ProviderTemplatesSection'

// All OAuth providers share the same flow via useOAuthProviderFlow

/**
 * Pane AI pane — manage LLM providers and the default model.
 */
export const PaneAiPane: FC = () => {
  const {
    providers,
    defaultProviderId,
    saveProvider,
    setDefaultProvider,
    deleteProvider,
  } = useLlmProviders()
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const { sessionInfo } = useSessionInfo()
  const queryClient = useQueryClient()
  const coding = useCodingAgents()
  const defaultTarget = useDefaultChatTarget({
    providers,
    agents: coding.agents,
    defaultProviderId,
    setDefaultProvider,
  })
  const { effectiveTarget } = defaultTarget
  const selectedProviderId =
    effectiveTarget.kind === 'llm' ? effectiveTarget.id : null
  const selectedAgentId =
    effectiveTarget.kind === 'acp' ? effectiveTarget.id : null

  const userId = sessionInfo.user?.id
  const cloudSyncEnabled = productFeatures.cloudSync

  const { data: profileData } = useGraphqlQuery(
    GetProfileIdByUserIdDocument,
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled
    { userId: userId! },
    { enabled: cloudSyncEnabled && !!userId },
  )
  const profileId = profileData?.profileByUserId?.rowId

  const { data: remoteProvidersData } = useGraphqlQuery(
    GetRemoteLlmProvidersDocument,
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled
    { profileId: profileId! },
    { enabled: cloudSyncEnabled && !!profileId },
  )

  const deleteRemoteProviderMutation = useGraphqlMutation(
    DeleteRemoteLlmProviderDocument,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [getQueryKeyFromDocument(GetRemoteLlmProvidersDocument)],
        })
      },
    },
  )

  const incompleteProviders = useMemo<IncompleteProvider[]>(() => {
    if (!remoteProvidersData?.llmProviders?.nodes) return []
    const localProviderIds = new Set(providers.map((p) => p.id))
    return remoteProvidersData.llmProviders.nodes
      .filter((node): node is NonNullable<typeof node> => node !== null)
      .filter((node) => !localProviderIds.has(node.rowId))
  }, [remoteProvidersData, providers])

  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [templateValues, setTemplateValues] = useState<
    Partial<LlmProviderConfig> | undefined
  >()
  const [editingProvider, setEditingProvider] =
    useState<LlmProviderConfig | null>(null)
  const [providerToDelete, setProviderToDelete] =
    useState<LlmProviderConfig | null>(null)
  const [incompleteProviderToDelete, setIncompleteProviderToDelete] =
    useState<IncompleteProvider | null>(null)
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  )

  // OAuth flows — shared hook eliminates per-provider duplication
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
  const clearActiveDeviceCode = () => {
    chatgptPro.clearDeviceCode()
    copilot.clearDeviceCode()
    qwenCode.clearDeviceCode()
  }

  const oauthFlows: Record<
    string,
    {
      startOAuthFlow: (url: string | undefined) => Promise<void>
      disconnect: () => Promise<void>
      disconnectedEvent: string
    }
  > = {
    'chatgpt-pro': {
      startOAuthFlow: chatgptPro.startOAuthFlow,
      disconnect: chatgptPro.disconnect,
      disconnectedEvent:
        OAUTH_PROVIDERS_CONFIG['chatgpt-pro'].disconnectedEvent,
    },
    'github-copilot': {
      startOAuthFlow: copilot.startOAuthFlow,
      disconnect: copilot.disconnect,
      disconnectedEvent:
        OAUTH_PROVIDERS_CONFIG['github-copilot'].disconnectedEvent,
    },
    'qwen-code': {
      startOAuthFlow: qwenCode.startOAuthFlow,
      disconnect: qwenCode.disconnect,
      disconnectedEvent: OAUTH_PROVIDERS_CONFIG['qwen-code'].disconnectedEvent,
    },
  }

  const handleAddProvider = () => {
    setTemplateValues(undefined)
    setIsNewDialogOpen(true)
  }

  const handleUseTemplate = (template: ProviderTemplate) => {
    // OAuth providers: trigger OAuth flow
    const oauthFlow = oauthFlows[template.id]
    if (oauthFlow) {
      oauthFlow.startOAuthFlow(agentServerUrl ?? undefined)
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
    setIsNewDialogOpen(true)
  }

  const handleUseCodingAgentTemplate = (adapterId: HarnessAgentAdapter) => {
    setTemplateValues({
      type: adapterId === 'codex' ? 'codex' : 'claude-code',
      name: adapterId === 'codex' ? 'Codex' : 'Claude Code',
      baseUrl: '',
      modelId: '',
      supportsImages: true,
      contextWindow: adapterId === 'codex' ? 400000 : 200000,
      temperature: 0.2,
    })
    setIsNewDialogOpen(true)
  }

  const handleEditProvider = (provider: LlmProviderConfig) => {
    setEditingProvider(provider)
    setIsEditDialogOpen(true)
  }

  const handleDeleteProvider = (provider: LlmProviderConfig) => {
    setProviderToDelete(provider)
  }

  const confirmDeleteProvider = async () => {
    if (!providerToDelete) return

    // Clear OAuth tokens on server for OAuth-based providers. An unavailable
    // local server must not prevent removal of the local provider.
    const oauthFlow = oauthFlows[providerToDelete.type]
    let disconnectFailed = false
    if (oauthFlow) {
      try {
        await oauthFlow.disconnect()
        track(oauthFlow.disconnectedEvent)
      } catch {
        disconnectFailed = true
      }
    }

    const wasLastRemoteHermes =
      providerToDelete.type === 'remote-hermes' &&
      providers.filter((p) => p.type === 'remote-hermes').length === 1

    await deleteProvider(providerToDelete.id)
    deleteRemoteProviderMutation.mutate({ rowId: providerToDelete.id })

    if (wasLastRemoteHermes && agentServerUrl) {
      void agentFetch(`${agentServerUrl}/remote-hermes/destroy`, {
        method: 'POST',
      }).catch(() => {
        // Best-effort; Fly machine is leaked if this fails. User can
        // re-add and re-delete to retry, or destroy via the worker
        // dashboard.
      })
    }

    setProviderToDelete(null)
    if (disconnectFailed) {
      toast.warning(
        'Provider removed, but its saved sign-in could not be cleared',
        {
          description:
            'When the local service is available, add this provider again and delete it to clear the saved sign-in.',
        },
      )
    }
  }

  const handleAddKeysToIncomplete = (provider: IncompleteProvider) => {
    const timestamp = Date.now()
    setTemplateValues({
      id: provider.rowId,
      type: provider.type as LlmProviderConfig['type'],
      name: provider.name,
      baseUrl: provider.baseUrl ?? undefined,
      modelId: provider.modelId,
      supportsImages: provider.supportsImages,
      contextWindow: provider.contextWindow ?? 128000,
      temperature: provider.temperature ?? 0.2,
      resourceName: provider.resourceName ?? undefined,
      region: provider.region ?? undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    setIsNewDialogOpen(true)
  }

  const handleDeleteIncompleteProvider = (provider: IncompleteProvider) => {
    setIncompleteProviderToDelete(provider)
  }

  const confirmDeleteIncompleteProvider = () => {
    if (incompleteProviderToDelete) {
      deleteRemoteProviderMutation.mutate({
        rowId: incompleteProviderToDelete.rowId,
      })
      setIncompleteProviderToDelete(null)
    }
  }

  const handleSaveProvider = async (provider: LlmProviderConfig) => {
    await saveProvider(provider)
    if (provider.type === 'remote-hermes' && agentServerUrl) {
      void agentFetch(`${agentServerUrl}/remote-hermes/start`, {
        method: 'POST',
      }).catch(() => {
        // Best-effort warm; user's first chat will still boot the VM if
        // this didn't reach the server. No toast — the boot pill handles
        // the visible feedback path.
      })
    }
  }

  const handleTestProvider = async (provider: LlmProviderConfig) => {
    if (!agentServerUrl) {
      toast.error('Test Failed', {
        description: (
          <span className="text-red-600 text-sm dark:text-red-400">
            Server URL not available
          </span>
        ),
        duration: 3000,
      })
      return
    }

    setTestingProviderId(provider.id)

    try {
      const result = await testProvider(provider, agentServerUrl)

      if (result.success) {
        toast.success('Test Successful', {
          description: (
            <span className="text-green-600 text-sm dark:text-green-400">
              {result.message}
            </span>
          ),
          duration: 3000,
        })
      } else {
        toast.error('Test Failed', {
          description: (
            <span className="text-red-600 text-sm dark:text-red-400">
              {result.message}
            </span>
          ),
          duration: 3000,
        })
      }
    } catch (error) {
      toast.error('Test Failed', {
        description: (
          <span className="text-red-600 text-sm dark:text-red-400">
            {error instanceof Error ? error.message : 'Unknown error'}
          </span>
        ),
        duration: 3000,
      })
    }

    setTestingProviderId(null)
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <LlmProvidersHeader
        providers={providers}
        agents={coding.agents}
        selectedTarget={effectiveTarget}
        onSelectTarget={defaultTarget.selectTarget}
        onAddProvider={handleAddProvider}
      />

      <McpPromoBanner />

      <ProviderTemplatesSection
        codingAdapters={coding.adapters}
        onCreateAgent={handleUseCodingAgentTemplate}
        onUseTemplate={handleUseTemplate}
      />

      <ConfiguredProvidersList
        providers={providers}
        selectedProviderId={selectedProviderId}
        testingProviderId={testingProviderId}
        onSelectProvider={defaultTarget.selectProvider}
        onTestProvider={handleTestProvider}
        onEditProvider={handleEditProvider}
        onDeleteProvider={handleDeleteProvider}
      />

      <CodingAgentsList
        controller={coding}
        selectedAgentId={selectedAgentId}
        onSelectAgent={defaultTarget.selectAgent}
      />

      <IncompleteProvidersList
        providers={incompleteProviders}
        onAddKeys={handleAddKeysToIncomplete}
        onDelete={handleDeleteIncompleteProvider}
      />

      <NewProviderDialog
        open={isNewDialogOpen}
        onOpenChange={setIsNewDialogOpen}
        initialValues={templateValues}
        onSave={handleSaveProvider}
      />

      <NewProviderDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        initialValues={editingProvider ?? undefined}
        onSave={handleSaveProvider}
      />

      <AlertDialog
        open={!!providerToDelete}
        onOpenChange={(open) => !open && setProviderToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{providerToDelete?.name}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProvider}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!incompleteProviderToDelete}
        onOpenChange={(open) => !open && setIncompleteProviderToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Synced Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "
              {incompleteProviderToDelete?.name}
              "? This will remove it from all your devices.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteIncompleteProvider}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeviceCodeDialog
        deviceCode={activeDeviceCode}
        onClose={clearActiveDeviceCode}
      />
    </div>
  )
}
