/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
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
      const prompt = [
        action.query,
        action.metadata && Object.keys(action.metadata).length
          ? `\n\nContext: ${JSON.stringify(action.metadata)}`
          : '',
      ].join('')

      // Stay on the PI page when returnRoute is set; run the agent in the
      // side panel so board/entity UI is not replaced by #/home/chat (X2).
      if (returnRoute) {
        const route = returnRoute.startsWith('#')
          ? returnRoute.slice(1)
          : returnRoute
        await executeWidgetAction({ type: 'navigate-route', route })
        try {
          await openSidePanelWithSearch('open', {
            query: prompt,
            mode: 'agent',
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
