/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Centralized execution registry for all widget actions.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

type QueryClientLike = {
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
    }
  | { type: 'complete-task'; taskId: string }
  | { type: 'run-skill'; skillId: string }
  | { type: 'agent-with-context'; prompt: string; context: unknown }
  | { type: 'copy'; text: string }

export async function executeWidgetAction(
  action: WidgetAction,
  queryClient?: QueryClientLike,
): Promise<void> {
  const base = await getAgentServerUrl()

  switch (action.type) {
    case 'navigate':
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url: action.url })
      } else {
        window.open(action.url, '_blank')
      }
      break

    case 'navigate-route':
      window.location.hash = action.route
      break

    case 'open-context-item':
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url: action.uri })
      } else {
        window.open(action.uri, '_blank')
      }
      break

    case 'resolve-approval':
      try {
        const res = await agentFetch(`${base}/scheduler/approvals/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: action.token }),
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
