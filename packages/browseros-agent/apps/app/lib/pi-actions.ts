/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { fetchActiveChatTurn } from '@/lib/conversations/chat-turn-api'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import {
  clearActiveRepairConversation,
  getActiveRepairConversation,
  setActiveRepairConversation,
} from '@/lib/pi-actions/activeRepairStorage'
import { executeWidgetAction } from '@/lib/widget-actions'
import {
  buildPiPageRefreshAction,
  type PiPageRefreshOpts,
} from '@/screens/personal-internet/piPageRefresh'
import type { PiAction } from '@/screens/personal-internet/types'

export type { PiPageRefreshOpts }
export { buildPiPageRefreshAction }

export async function refreshPiPageWithAgent(
  opts: PiPageRefreshOpts,
): Promise<void> {
  await executePiAction(buildPiPageRefreshAction(opts))
}

export async function executePiAction(action: PiAction): Promise<void> {
  switch (action.kind) {
    case 'open-internal': {
      const route = action.route.startsWith('#')
        ? action.route.slice(1)
        : action.route
      await executeWidgetAction({ type: 'navigate-route', route })
      return
    }
    case 'open-external':
      await executeWidgetAction({ type: 'navigate', url: action.url })
      return
    case 'local':
      // filter / expand are client presentation-only (renderer may handle later).
      // dismiss is intentionally a no-op at the action layer for v1.
      if (action.op === 'copy' && typeof action.args?.text === 'string') {
        await executeWidgetAction({ type: 'copy', text: action.args.text })
      }
      return
    case 'agent': {
      const returnRoute =
        typeof action.metadata?.returnRoute === 'string'
          ? action.metadata.returnRoute
          : undefined
      const intent =
        typeof action.metadata?.intent === 'string'
          ? action.metadata.intent
          : undefined
      const pageId =
        typeof action.metadata?.pageId === 'string'
          ? action.metadata.pageId
          : undefined
      const isPiRepairIntent =
        intent === 'pi-page-refresh' || intent === 'pi-page-repair'

      const navigateToReturnRoute = async () => {
        if (!returnRoute) return
        const route = returnRoute.startsWith('#')
          ? returnRoute.slice(1)
          : returnRoute
        await executeWidgetAction({ type: 'navigate-route', route })
      }

      // PI repair/refresh actions are keyed by pageId: a second click (impatient
      // retry, or a reload while the first run is still going) must reattach to
      // the in-flight turn instead of starting an identical, orphaning duplicate.
      if (isPiRepairIntent && pageId) {
        const inFlightConversationId = await getActiveRepairConversation(pageId)
        if (inFlightConversationId) {
          const active = await fetchActiveChatTurn(
            inFlightConversationId,
          ).catch(() => null)
          if (active?.status === 'running') {
            await navigateToReturnRoute()
            try {
              await openSidePanelWithSearch('open', {
                requestId: crypto.randomUUID(),
                query: '',
                mode: 'agent',
                conversationId: inFlightConversationId,
              })
            } catch {
              // Side panel unavailable — stay on PI.
            }
            return
          }
          await clearActiveRepairConversation(pageId)
        }
      }

      const prompt = [
        action.query,
        action.metadata && Object.keys(action.metadata).length
          ? `\n\nContext: ${JSON.stringify(action.metadata)}`
          : '',
      ].join('')

      const newConversationId = isPiRepairIntent
        ? crypto.randomUUID()
        : undefined
      if (isPiRepairIntent && pageId && newConversationId) {
        await setActiveRepairConversation(pageId, newConversationId)
      }

      // Stay on the PI page when returnRoute is set; run the agent in the
      // side panel so board/entity UI is not replaced by #/home/chat (X2).
      if (returnRoute) {
        await navigateToReturnRoute()
        try {
          await openSidePanelWithSearch('open', {
            requestId: crypto.randomUUID(),
            query: prompt,
            mode: 'agent',
            ...(newConversationId ? { newConversationId } : {}),
          })
        } catch {
          // Side panel unavailable — stay on PI; do not navigate to #/home/chat.
        }
        return
      }

      await executeWidgetAction({
        type: 'agent-with-context',
        prompt,
        context: action.metadata,
      })
      return
    }
  }
}
