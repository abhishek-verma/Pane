/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { executeWidgetAction } from '@/lib/widget-actions'
import type { PiAction } from '@/screens/personal-internet/types'

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
      if (action.op === 'copy' && typeof action.args?.text === 'string') {
        await executeWidgetAction({ type: 'copy', text: action.args.text })
      }
      return
    case 'agent': {
      const prompt = [
        action.query,
        action.metadata && Object.keys(action.metadata).length
          ? `\n\nContext: ${JSON.stringify(action.metadata)}`
          : '',
      ].join('')
      await executeWidgetAction({
        type: 'agent-with-context',
        prompt,
        context: action.metadata,
      })
      return
    }
  }
}

export async function invokePiActionApi(action: PiAction): Promise<{
  mode: 'done' | 'agent'
  route?: string
}> {
  if (action.kind !== 'agent') {
    await executePiAction(action)
    return { mode: 'done' }
  }
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}/pi/actions/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) {
    await executePiAction(action)
    return { mode: 'agent' }
  }
  const data = (await res.json()) as { mode?: string; route?: string }
  if (data.mode === 'agent' || action.kind === 'agent') {
    await executePiAction(action)
    return { mode: 'agent', route: data.route }
  }
  return { mode: 'done', route: data.route }
}
