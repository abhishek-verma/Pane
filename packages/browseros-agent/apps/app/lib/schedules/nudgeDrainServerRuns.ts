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

export async function nudgeDrainServerRuns(): Promise<void> {
  await drainPendingRunsOnce({
    getBaseUrl: getAgentServerUrl,
    fetchFn: agentFetch as typeof fetch,
    runChat: async ({ message, scheduledRunId, idempotencyKey }) => {
      const response = await getChatServerResponse({
        message,
        scheduledRunId,
        idempotencyKey,
      })
      return {
        text: response.text,
        conversationId: response.conversationId,
      }
    },
  })
}
