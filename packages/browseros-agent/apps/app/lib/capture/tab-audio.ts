/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
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

  const streamId = await resolveStreamId(input.tabId)
  const serverUrl = await getAgentServerUrl()
  await ensureCaptureOffscreenDocument()

  const response = (await chrome.runtime.sendMessage({
    type: 'capture-audio-start',
    payload: {
      sessionId: input.sessionId,
      tabId: input.tabId,
      streamId,
      serverUrl,
    },
  })) as { ok?: boolean; error?: string } | undefined

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

  await chrome.runtime
    .sendMessage({
      type: 'capture-audio-stop',
      payload: { sessionId },
    })
    .catch(() => null)

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
