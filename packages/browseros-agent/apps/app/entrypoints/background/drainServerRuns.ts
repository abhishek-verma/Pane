/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Drains server `scheduled_runs` pending rows into `/chat` (trigger / keep-alive).
 */

import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { drainPendingRunsOnce } from '@/lib/schedules/drainPendingRuns'
import { getChatServerResponse } from '@/lib/schedules/getChatServerResponse'

const ALARM_NAME = 'drain-server-runs'
const PERIOD_MINUTES = 1

export { drainPendingRunsOnce } from '@/lib/schedules/drainPendingRuns'

export function drainServerRuns(): void {
  const tick = async () => {
    try {
      await drainPendingRunsOnce({
        getBaseUrl: getAgentServerUrl,
        fetchFn: fetch.bind(globalThis),
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
    } catch {
      // Server may be down while the extension is up — retry next alarm.
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
