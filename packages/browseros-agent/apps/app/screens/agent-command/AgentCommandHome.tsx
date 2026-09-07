/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Compass,
  FolderOpen,
  ListChecks,
  Search,
} from 'lucide-react'
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
  return greeting
}

export const AgentCommandHome: FC = () => {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<{ text: string; id: number }>()
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

  const startDraft = (text: string) => setDraft({ text, id: Date.now() })

  return (
    <div className="min-h-full bg-muted/15">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <span className="font-semibold text-sm">Home</span>
        <HomeAction to="/pi/library">
          <FolderOpen className="size-4" />
          Saved work
        </HomeAction>
      </header>
      <main className="mx-auto w-full max-w-5xl space-y-8 px-5 pt-6 pb-16 sm:px-8 sm:pt-10">
        <section aria-labelledby="home-heading" className="mx-auto max-w-3xl">
          <p className="mb-2 text-muted-foreground text-sm">
            {homeGreeting(homeData?.firstName ?? null)}
          </p>
          <h1
            id="home-heading"
            className="font-semibold text-3xl leading-tight tracking-tight sm:text-4xl"
          >
            What would you like to do?
          </h1>
          <p className="mt-3 mb-6 text-base text-muted-foreground">
            Find answers, compare options, or get a task done.
          </p>
          <ConversationInput
            variant="home"
            draft={draft}
            providers={providerOptions}
            selectedProvider={selectedProvider}
            onSelectProvider={setSelectedProvider}
            onSend={async (input) => {
              setSendError(null)
              try {
                await handleSend(input)
              } catch {
                setSendError('Your task couldn’t start. Please try again.')
                setDraft({ text: input.text, id: Date.now() })
              }
            }}
            streaming={false}
            disabled={!selectedProvider || waitingForLlmCapabilities}
            attachmentsEnabled={true}
            placeholder="Tell Pane what you need help with…"
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
              <HomeAction to="/settings/llm">Set up assistant</HomeAction>
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              {
                icon: Search,
                label: 'Research a topic',
                prompt: 'Help me research ',
              },
              {
                icon: Compass,
                label: 'Compare options',
                prompt: 'Help me compare ',
              },
              {
                icon: ListChecks,
                label: 'Make a plan',
                prompt: 'Help me make a plan for ',
              },
            ].map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                type="button"
                onClick={() => startDraft(prompt)}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Icon className="size-4 text-primary" />
                <span className="flex-1">{label}</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
        <ContinueSites />
        {homeLoading ? (
          <div
            role="status"
            aria-label="Loading saved work"
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="h-36 animate-pulse rounded-2xl bg-muted" />
            <div className="h-36 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : homeError || homeData?.piUnavailable ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background p-5"
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
