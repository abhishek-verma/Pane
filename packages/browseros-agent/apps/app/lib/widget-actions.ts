/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Centralized execution registry for all widget actions.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { openPiHref } from '@/lib/personal-internet/open-pi-href'
import {
  isPiRoutePath,
  navigateOwnedRoute,
} from '@/lib/personal-internet/pi-document'

import { resolveChannelApproval } from '@/lib/trust/resolve-channel-approval'

export type QueryClientLike = {
  invalidateQueries: (opts: { queryKey: string[] }) => unknown
}

export type WidgetAction =
  | { type: 'navigate'; url: string }
  | { type: 'navigate-route'; route: string }
  | { type: 'open-context-item'; itemId: string; uri: string }
  | {
      type: 'resolve-approval'
      approvalId: string
      token: string
      resolution: 'approve' | 'deny'
      trustScope?: 'chat' | 'always'
    }
  | { type: 'complete-task'; taskId: string }
  | { type: 'run-skill'; skillId: string }
  | { type: 'agent-with-context'; prompt: string; context: unknown }
  | { type: 'copy'; text: string }

export type WidgetActionResult = {
  ok: boolean
  detail: string
  /** False when approve/deny hit a dead waiter (timeout/restart). */
  resumed?: boolean
}

export async function executeWidgetAction(
  action: WidgetAction,
  queryClient?: QueryClientLike,
): Promise<WidgetActionResult | undefined> {
  const base = await getAgentServerUrl()

  switch (action.type) {
    case 'navigate':
      if (action.url.startsWith('pi://') || action.url.startsWith('#/pi/')) {
        await openPiHref(action.url)
        break
      }
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url: action.url })
      } else {
        window.open(action.url, '_blank')
      }
      break

    case 'navigate-route': {
      const path = action.route.startsWith('#')
        ? action.route.slice(1)
        : action.route.startsWith('/')
          ? action.route
          : `/${action.route}`
      if (isPiRoutePath(path)) {
        await openPiHref(`#${path}`)
        break
      }
      navigateOwnedRoute(path)
      break
    }

    case 'open-context-item':
      if (action.uri.startsWith('pi://')) {
        await openPiHref(action.uri)
        break
      }
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url: action.uri })
      } else {
        window.open(action.uri, '_blank')
      }
      break

    case 'resolve-approval': {
      const result = await resolveChannelApproval(
        action.token,
        action.resolution === 'approve' ? action.trustScope : undefined,
      )
      if (queryClient) {
        void queryClient.invalidateQueries({
          queryKey: ['scheduler', 'home'],
        })
      }
      return result
    }

    case 'complete-task':
      try {
        const res = await agentFetch(`${base}/tasks/${action.taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'done' }),
        })
        if (res.ok && queryClient) {
          void queryClient.invalidateQueries({
            queryKey: ['scheduler', 'home'],
          })
        }
      } catch {
        /* ignore transient network errors */
      }
      break

    case 'run-skill':
      try {
        const prefillPrompt = `/run-skill ${action.skillId}`
        window.location.hash = `#/home/chat?prefill=${encodeURIComponent(prefillPrompt)}`
      } catch {
        /* ignore */
      }
      break

    case 'agent-with-context':
      try {
        const encodedPrompt = encodeURIComponent(action.prompt)
        // NewTabChat auto-sends on `q`, not `prefill`.
        window.location.hash = `#/home/chat?q=${encodedPrompt}&mode=agent`
      } catch {
        /* ignore */
      }
      break

    case 'copy':
      try {
        await navigator.clipboard.writeText(action.text)
      } catch {
        /* ignore clipboard failures */
      }
      break
  }
}
