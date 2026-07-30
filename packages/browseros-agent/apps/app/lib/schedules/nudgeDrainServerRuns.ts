/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Best-effort drain of pending scheduled_runs so PI materialize/harvest
 * does not wait for the background 1-minute alarm.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { drainPendingRunsOnce } from '@/lib/schedules/drainPendingRuns'
import { getChatServerResponse } from '@/lib/schedules/getChatServerResponse'

export async function nudgeDrainServerRuns(options?: {
  runIds?: string[]
}): Promise<void> {
  await drainPendingRunsOnce({
    getBaseUrl: getAgentServerUrl,
    fetchFn: agentFetch as typeof fetch,
    runIds: options?.runIds,
    // Without explicit runIds, never fan-out pi-materialize from a generic nudge.
    skipSources: options?.runIds?.length ? undefined : ['pi-materialize'],
    runChat: async ({
      message,
      scheduledRunId,
      idempotencyKey,
      conversationId,
    }) => {
      const response = await getChatServerResponse({
        message,
        scheduledRunId,
        idempotencyKey,
        conversationId,
      })
      return {
        text: response.text,
        conversationId: response.conversationId,
      }
    },
  })
}
