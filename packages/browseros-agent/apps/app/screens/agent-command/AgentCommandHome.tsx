/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
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
import { ContinueSites } from '@/screens/newtab/home/ContinueSites'
import { EmptyHomeState } from '@/screens/newtab/home/EmptyHomeState'
import { GrowthSignal } from '@/screens/newtab/home/GrowthSignal'
import {
  fetchHome,
  HOME_QUERY_KEY,
  type HomeData,
} from '@/screens/newtab/home/home-data'
import { PiHomeRegions } from '@/screens/newtab/home/PiHomeRegions'
import { useActiveHint } from '@/screens/newtab/index/active-hint.hooks'
import { SignInHint } from '@/screens/newtab/index/SignInHint'
import {
  PiRailAction,
  PiStatusDot,
  PiTopRail,
} from '@/screens/personal-internet/PiChrome'
import {
  piPost,
  usePiInvalidateListener,
} from '@/screens/personal-internet/usePiApi'
import {
  ConversationInput,
  type ConversationInputSendInput,
} from './ConversationInput'
import {
  resolveHomeLlmRoutingMode,
  routeHomeSend,
} from './home-compose.helpers'
import { setPendingInitialMessage } from './pending-initial-message'

function homeGreeting(firstName: string | null): string {
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (firstName) return `${greeting}, ${firstName}`
  return 'What should Pane work on next?'
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

function homeStatusLabel(pi: HomeData['pi'], loading: boolean): string {
  if (loading) return 'Loading'
  const continuity = pi?.continuity?.length ?? 0
  const doorways = pi?.doorways?.length ?? 0
  if (continuity > 0) return `${continuity} open`
  if (doorways > 0) return `${doorways} live`
  return 'Idle'
}

export const AgentCommandHome: FC = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const activeHint = useActiveHint()
  usePiInvalidateListener()
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

  const {
    data: homeData,
    isLoading: homeLoading,
    isError: homeError,
  } = useQuery({
    queryKey: HOME_QUERY_KEY,
    queryFn: fetchHome,
    staleTime: 5_000,
    refetchInterval: 30_000,
  })

  const hasMarkedVisitRef = useRef(false)
  useEffect(() => {
    if (homeLoading || hasMarkedVisitRef.current) return
    hasMarkedVisitRef.current = true
    void piPost('/pi/home/mark-visited', {})
  }, [homeLoading])

  useEffect(() => {
    const HOME_FOCUSED_DEBOUNCE_MS = 60_000
    let lastFired = 0
    let timer: number | null = null

    const fire = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastFired < HOME_FOCUSED_DEBOUNCE_MS) return
      lastFired = now
      void piPost('/pi/refresh', { trigger: 'home-focused' })
        .then(() => queryClient.invalidateQueries({ queryKey: HOME_QUERY_KEY }))
        .catch(() => undefined)
    }

    // Initial focus after short settle (still subject to debounce window).
    timer = window.setTimeout(fire, 800)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fire()
    }
    const onFocus = () => fire()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer != null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [queryClient])

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
        requestId: crypto.randomUUID(),
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
  const statusLive =
    !homeLoading &&
    ((homeData?.pi?.continuity.length ?? 0) > 0 ||
      (homeData?.pi?.doorways.length ?? 0) > 0)

  return (
    <div className="min-h-full">
      <PiTopRail
        crumbs={['HOME']}
        status={
          <PiStatusDot
            label={homeStatusLabel(homeData?.pi, homeLoading)}
            live={statusLive}
          />
        }
        actions={<PiRailAction to="/pi/library">Library</PiRailAction>}
      />

      <div className="border-border border-b px-5 py-2 font-mono text-[11px] text-muted-foreground tracking-wide">
        {homeSubtitle(homeData?.pi)}
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 pb-16">
        <div className="space-y-4">
          <h1 className="font-semibold text-2xl leading-tight tracking-[-0.02em]">
            {homeGreeting(homeData?.firstName ?? null)}
          </h1>
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

        <ContinueSites />

        <div className="flex flex-col gap-0">
          {homeLoading ? (
            <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
              Loading your private web…
            </p>
          ) : homeError ? (
            <p className="text-destructive text-sm">
              Could not load home. Check that the Pane agent server is running.
            </p>
          ) : hasLivingWork ? (
            <PiHomeRegions data={homeData?.pi} />
          ) : (
            <EmptyHomeState />
          )}
        </div>

        <GrowthSignal growth={homeData?.growth} />
      </div>

      {activeHint === 'signin' ? <SignInHint /> : null}
    </div>
  )
}
