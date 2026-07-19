/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'
import {
  closeCaptureOffscreenDocumentIfIdle,
  ensureCaptureOffscreenDocument,
} from './offscreen-audio'

async function resolveStreamId(tabId: number): Promise<string> {
  const adapter = getBrowserOSAdapter()
  if (adapter.isAPIAvailable('captureTabAudio')) {
    return new Promise((resolve, reject) => {
      chrome.browserOS.captureTabAudio(
        tabId,
        { captureClass: 'meeting', bucketId: 'default' },
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          resolve(result.streamId)
        },
      )
    })
  }

  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(
          new Error(
            chrome.runtime.lastError?.message ??
              'tabCapture stream unavailable',
          ),
        )
        return
      }
      resolve(streamId)
    })
  })
}

const activeSessions = new Map<string, number>()

export async function startTabAudioCapture(input: {
  sessionId: string
  tabId: number
}): Promise<void> {
  if (activeSessions.has(input.sessionId)) return

  // Resolve the server URL before stream setup so a mid-start port flip does
  // not strand chunk uploads on a different process than session create.
  // Uploads also refresh this URL live via getCaptureServerUrl.
  const serverUrl = await getAgentServerUrl()
  const streamId = await resolveStreamId(input.tabId)
  await ensureCaptureOffscreenDocument()

  const response = await sendRuntimeMessage(
    RuntimeMessageType.captureAudioStart,
    {
      sessionId: input.sessionId,
      tabId: input.tabId,
      streamId,
      serverUrl,
      // Mix mic into the offscreen AudioContext (TabScribe / Recall pattern).
      includeMic: true,
    },
  )

  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Offscreen audio capture failed to start',
    )
  }

  activeSessions.set(input.sessionId, input.tabId)
}

export async function stopTabAudioCapture(sessionId: string): Promise<void> {
  const tabId = activeSessions.get(sessionId)
  if (tabId === undefined) return

  await sendRuntimeMessage(RuntimeMessageType.captureAudioStop, {
    sessionId,
  }).catch(() => null)

  activeSessions.delete(sessionId)
  await closeCaptureOffscreenDocumentIfIdle()

  const adapter = getBrowserOSAdapter()
  if (adapter.isAPIAvailable('stopCaptureTabAudio')) {
    chrome.browserOS.stopCaptureTabAudio(tabId, () => {})
  }
}

export function isRecording(sessionId: string): boolean {
  return activeSessions.has(sessionId)
}

export function recordingSessionIds(): string[] {
  return Array.from(activeSessions.keys())
}

/** Local recorder tab binding — used to hard-stop when a tab closes. */
export function recordingTabId(sessionId: string): number | undefined {
  return activeSessions.get(sessionId)
}

export function sessionIdsForTab(tabId: number): string[] {
  const out: string[] = []
  for (const [sessionId, boundTabId] of activeSessions) {
    if (boundTabId === tabId) out.push(sessionId)
  }
  return out
}
