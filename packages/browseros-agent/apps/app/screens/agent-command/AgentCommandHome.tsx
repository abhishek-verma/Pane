import {
  composerKey,
  emptyComposer,
  updateComposer,
} from '@/modules/chat/composer-store'
import { TodayAgenda } from '@/screens/newtab/home/TodayAgenda'
import '@/screens/newtab/home/home.css'
/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
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
import { fetchHome, HOME_QUERY_KEY } from '@/screens/newtab/home/home-data'
import { HomeAction, PiHomeRegions } from '@/screens/newtab/home/PiHomeRegions'
import { useActiveHint } from '@/screens/newtab/index/active-hint.hooks'
import { SignInHint } from '@/screens/newtab/index/SignInHint'
import { PiTopRail } from '@/screens/personal-internet/PiChrome'
import {
  piPost,
  usePiInvalidateListener,
} from '@/screens/personal-internet/usePiApi'
import {
  ConversationInput,
  type ConversationInputSendInput,
} from './ConversationInput'
import {
  harnessHomeText,
  resolveHomeLlmRoutingMode,
  routeHomeSend,
} from './home-compose.helpers'
import { setPendingInitialMessage } from './pending-initial-message'

function homeGreeting(firstName: string | null): string {
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (firstName) return `${greeting}, ${firstName}`
  return greeting
}

export const AgentCommandHome: FC = () => {
  const navigate = useNavigate()
  const [sendError, setSendError] = useState<string | null>(null)
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
    refetch: refetchHome,
  } = useQuery({
    queryKey: HOME_QUERY_KEY,
    queryFn: fetchHome,
    staleTime: 5_000,
    refetchInterval: 30_000,
  })

  const hasMarkedVisitRef = useRef(false)
  // generatedAt isn't read in the body — it's a retry trigger. It changes on
  // every /scheduler/home fetch, so a transient piPost failure below (which
  // resets the ref) gets retried on the next poll instead of permanently
  // freezing the "updated while you were away" markers for the session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (
      homeLoading ||
      !homeData?.pi ||
      homeData.piUnavailable ||
      hasMarkedVisitRef.current
    )
      return
    hasMarkedVisitRef.current = true
    void piPost('/pi/home/mark-visited', {})
      .then((res) => {
        if (!res.ok) hasMarkedVisitRef.current = false
      })
      .catch(() => {
        hasMarkedVisitRef.current = false
      })
  }, [homeLoading, homeData?.pi?.generatedAt])

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
    if (!selectedProvider) throw new Error('No assistant selected')
    if (selectedProvider.kind === 'llm' && llmRoutingMode === 'wait')
      throw new Error('Assistant is still loading')
    if (input.attachments.length && selectedProvider.kind === 'llm') {
      const target = targets.find(
        (entry) => entry.kind === 'llm' && entry.id === selectedProvider.id,
      )
      await persistSidepanelChatTargetSelection(target)
      await setDefaultProvider(selectedProvider.id)
      const conversationId = crypto.randomUUID()
      await updateComposer(
        composerKey(conversationId, selectedProvider.id),
        () => ({
          ...emptyComposer(),
          draft: {
            text: input.text,
            tabs: input.selectedTabs,
            attachments: input.attachments,
          },
        }),
      )
      navigate(
        `/home/chat?conversationId=${conversationId}&sendDraft=${encodeURIComponent(selectedProvider.id)}`,
      )
      return
    }
    const agentSessionId =
      selectedProvider.kind === 'acp' ? crypto.randomUUID() : undefined
    const text =
      selectedProvider.kind === 'acp'
        ? harnessHomeText(
            input.text,
            input.selectedTabs,
            input.attachments.length > 0,
          )
        : input.text
    const route = routeHomeSend(selectedProvider, text, {
      agentSessionId,
      selectedTabs: input.selectedTabs,
    })
    if (!route) throw new Error('Unable to route this task')
    if (route.kind === 'acp') {
      if (!agentSessionId) return
      setPendingInitialMessage({
        agentId: route.agentId,
        sessionId: agentSessionId,
        text,
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

  return (
    <div className="pane-home min-h-full bg-background">
      <PiTopRail
        crumbs={['HOME']}
        actions={
          <HomeAction to="/pi/library">
            <FolderOpen className="size-3.5" />
            Your work
          </HomeAction>
        }
      />
      <main className="mx-auto w-full max-w-4xl space-y-8 px-5 pt-10 pb-12 sm:px-8 sm:pt-10">
        <section aria-labelledby="home-heading" className="w-full">
          <h1
            id="home-heading"
            className="mb-6 font-medium text-2xl tracking-[-0.03em] sm:text-[28px]"
          >
            {homeGreeting(homeData?.firstName ?? null)}
          </h1>
          <ConversationInput
            variant="home"
            providers={providerOptions}
            selectedProvider={selectedProvider}
            onSelectProvider={setSelectedProvider}
            onSend={async (input) => {
              setSendError(null)
              try {
                await handleSend(input)
              } catch {
                setSendError('Your task couldn’t start. Please try again.')
                return false
              }
            }}
            streaming={false}
            disabled={!selectedProvider || waitingForLlmCapabilities}
            attachmentsEnabled={true}
            placeholder="Ask Pane…"
            onOpenVoiceMode={() => navigate('/home/chat?voice=open&mode=agent')}
          />
          {sendError ? (
            <p role="alert" className="mt-3 text-destructive text-sm">
              {sendError}
            </p>
          ) : null}
          {!selectedProvider ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
              <span>Connect an assistant to start a task.</span>
              <HomeAction to="/settings/ai">Set up assistant</HomeAction>
            </div>
          ) : null}
          <ContinueSites />
        </section>
        <TodayAgenda />
        {homeLoading ? (
          <div
            role="status"
            aria-label="Loading saved work"
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="h-36 animate-pulse bg-muted" />
            <div className="h-36 animate-pulse bg-muted" />
          </div>
        ) : homeError || homeData?.piUnavailable ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border border-border bg-background p-5"
          >
            <p className="text-muted-foreground text-sm">
              Saved work is temporarily unavailable. You can still start a task
              above.
            </p>
            <HomeAction onClick={() => void refetchHome()}>
              Try again
            </HomeAction>
          </div>
        ) : (
          <PiHomeRegions data={homeData?.pi} />
        )}
      </main>
      {activeHint === 'signin' ? <SignInHint /> : null}
    </div>
  )
}
