/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Drains server `scheduled_runs` pending rows into `/chat` (trigger / keep-alive).
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { onScheduleMessage } from '@/lib/messaging/schedules/scheduleMessages'
import { drainPendingRunsOnce } from '@/lib/schedules/drainPendingRuns'
import { getChatServerResponse } from '@/lib/schedules/getChatServerResponse'
import { nudgeDrainServerRuns } from '@/lib/schedules/nudgeDrainServerRuns'

const ALARM_NAME = 'drain-server-runs'
const PERIOD_MINUTES = 1

import '@/lib/schedules/drainPendingRuns'

export function drainServerRuns(): void {
  let draining = false
  onScheduleMessage('reviewAgenda', ({ data }) => {
    // The run is durable before this message; the alarm remains a fallback.
    void nudgeDrainServerRuns({ runIds: [data.runId] }).catch(() => undefined)
    return { success: true }
  })

  const tick = async () => {
    if (draining) return
    draining = true
    try {
      await drainPendingRunsOnce({
        getBaseUrl: getAgentServerUrl,
        fetchFn: agentFetch as typeof fetch,
        // Never start lazy entity BTF from the background alarm — only
        // EntityPage targeted nudge (runIds) may drain pi-materialize.
        skipSources: ['pi-materialize'],
        runChat: async ({
          message,
          scheduledRunId,
          idempotencyKey,
          conversationId,
          useSelectedWorkspace,
          executionContext,
        }) => {
          const response = await getChatServerResponse({
            message,
            scheduledRunId,
            idempotencyKey,
            conversationId,
            useSelectedWorkspace,
            executionContext,
          })
          return {
            text: response.text,
            conversationId: response.conversationId,
          }
        },
      })
    } catch {
      // Server may be down while the extension is up — retry next alarm.
    } finally {
      draining = false
    }
  }

  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void tick()
  })

  chrome.runtime.onStartup.addListener(() => {
    void tick()
  })
  chrome.runtime.onInstalled.addListener(() => {
    void tick()
  })
}
