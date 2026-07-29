/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQuery } from '@tanstack/react-query'
import { type FC, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { Feature } from '@/lib/browseros/capabilities'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import {
  useAgentAdapters,
  useHarnessAgents,
} from '@/modules/agents/agents.hooks'
import { useCapabilities } from '@/modules/browseros/capabilities.hooks'
import { toProviderOption } from '@/modules/chat/chat-session-request'
import {
  buildSidepanelChatTargets,
  persistSidepanelChatTargetSelection,
  resolveSidepanelChatTarget,
} from '@/modules/chat/sidepanel-chat-targets'
import { useLlmProviders } from '@/modules/llm-providers/llm-providers.hooks'
import { EmptyHomeState } from '@/screens/newtab/home/EmptyHomeState'
import {
  fetchHome,
  HOME_QUERY_KEY,
  type HomeData,
} from '@/screens/newtab/home/home-data'
import { PiHomeRegions } from '@/screens/newtab/home/PiHomeRegions'
import { useActiveHint } from '@/screens/newtab/index/active-hint.hooks'
import { RecentSites } from '@/screens/newtab/index/RecentSites'
import { ScheduleResults } from '@/screens/newtab/index/ScheduleResults'
import { SignInHint } from '@/screens/newtab/index/SignInHint'
import {
  ConversationInput,
  type ConversationInputSendInput,
} from './ConversationInput'
import {
  resolveHomeLlmRoutingMode,
  routeHomeSend,
} from './home-compose.helpers'
import { setPendingInitialMessage } from './pending-initial-message'

const ContextualGreeting: FC<{ firstName: string | null }> = ({
  firstName,
}) => {
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (firstName) {
    return (
      <>
        {greeting},{' '}
        <span className="font-medium text-[var(--accent-orange)] italic">
          {firstName}
        </span>
      </>
    )
  }
  return (
    <>
      What should your agent{' '}
      <span className="font-medium text-[var(--accent-orange)] italic">
        work on
      </span>{' '}
      next?
    </>
  )
}

function homeSubtitle(pi: HomeData['pi']): string {
  const doorways = pi?.doorways?.length ?? 0
  if (doorways === 0) {
    return 'Ask Pane to start living work — a job search, research hub, or anything you need to keep running.'
  }
  if (doorways === 1) {
    return 'One living site is ready below — open it, or ask Pane for the next move.'
  }
  return `${doorways} living sites below — pick one up, or ask Pane for the next move.`
}

export const AgentCommandHome: FC = () => {
  const navigate = useNavigate()
  const activeHint = useActiveHint()
  const {
    providers: llmProviders,
    defaultProviderId,
    setDefaultProvider,
  } = useLlmProviders()
  const { harnessAgents } = useHarnessAgents()
  const { adapters } = useAgentAdapters()
  const { supports, isLoading: capabilitiesLoading } = useCapabilities()
  const supportsInlineChat = supports(Feature.NEWTAB_CHAT_SUPPORT)
  const llmRoutingMode = resolveHomeLlmRoutingMode({
    capabilitiesLoading,
    supportsInlineChat,
  })
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null,
  )
  const waitingForLlmCapabilities =
    selectedProvider?.kind === 'llm' && llmRoutingMode === 'wait'

  const { data: homeData } = useQuery({
    queryKey: HOME_QUERY_KEY,
    queryFn: fetchHome,
    staleTime: 5_000,
    refetchInterval: 20_000,
  })

  const targets = useMemo(
    () =>
      buildSidepanelChatTargets({
        providers: llmProviders,
        adapters,
        agents: harnessAgents,
      }),
    [llmProviders, adapters, harnessAgents],
  )
  const providerOptions = useMemo(
    () => targets.map(toProviderOption),
    [targets],
  )

  useEffect(() => {
    if (targets.length === 0) return
    const stillValid =
      selectedProvider &&
      providerOptions.some(
        (option) =>
          option.id === selectedProvider.id &&
          option.kind === selectedProvider.kind,
      )
    if (stillValid) return
    const fallback = resolveSidepanelChatTarget({ targets, defaultProviderId })
    setSelectedProvider(fallback ? toProviderOption(fallback) : null)
  }, [targets, providerOptions, selectedProvider, defaultProviderId])

  const handleSend = async (input: ConversationInputSendInput) => {
    if (!selectedProvider) return
    if (selectedProvider.kind === 'llm' && llmRoutingMode === 'wait') return
    const agentSessionId =
      selectedProvider.kind === 'acp' ? crypto.randomUUID() : undefined
    const route = routeHomeSend(selectedProvider, input.text, {
      agentSessionId,
      selectedTabs: input.selectedTabs,
    })
    if (!route) return
    if (route.kind === 'acp') {
      if (!agentSessionId) return
      setPendingInitialMessage({
        agentId: route.agentId,
        sessionId: agentSessionId,
        text: input.text,
        attachments: input.attachments,
        createdAt: Date.now(),
      })
      navigate(route.path)
      return
    }
    const target = targets.find(
      (entry) => entry.kind === 'llm' && entry.id === route.providerId,
    )
    await persistSidepanelChatTargetSelection(target)
    await setDefaultProvider(route.providerId)
    if (llmRoutingMode === 'sidepanel') {
      const action = createBrowserOSAction({
        mode: 'agent',
        message: input.text,
        tabs: input.selectedTabs,
      })
      await openSidePanelWithSearch('open', {
        query: input.text,
        mode: 'agent',
        action,
      })
      return
    }
    navigate(route.path)
  }

  const hasLivingWork =
    (homeData?.pi?.doorways.length ?? 0) > 0 ||
    (homeData?.pi?.continuity.length ?? 0) > 0 ||
    (homeData?.pi?.libraryCount ?? 0) > 0

  return (
    <div className="min-h-full px-4 py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="flex flex-col items-center gap-5 pt-[max(10vh,24px)] text-center">
          <div className="space-y-3">
            <h1 className="font-semibold text-[clamp(2.25rem,4.5vw,3.5rem)] leading-[1.08] tracking-[-0.025em] [text-wrap:balance]">
              <ContextualGreeting firstName={homeData?.firstName ?? null} />
            </h1>
            <p className="mx-auto max-w-2xl text-muted-foreground text-sm leading-6 [text-wrap:pretty]">
              {homeSubtitle(homeData?.pi)}
            </p>
          </div>

          <div className="w-full max-w-3xl">
            <ConversationInput
              variant="home"
              providers={providerOptions}
              selectedProvider={selectedProvider}
              onSelectProvider={setSelectedProvider}
              onSend={handleSend}
              streaming={false}
              disabled={!selectedProvider || waitingForLlmCapabilities}
              attachmentsEnabled={true}
              placeholder={
                selectedProvider
                  ? `Ask ${selectedProvider.name} to handle a task...`
                  : 'Loading providers...'
              }
              onOpenVoiceMode={() => {
                navigate('/home/chat?voice=open&mode=agent')
              }}
            />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 pb-12">
          {hasLivingWork ? (
            <PiHomeRegions data={homeData?.pi} />
          ) : (
            <EmptyHomeState />
          )}
          <RecentSites />
          <ScheduleResults />
        </div>
      </div>

      {activeHint === 'signin' ? <SignInHint /> : null}
    </div>
  )
}
