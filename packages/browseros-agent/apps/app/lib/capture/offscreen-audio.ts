/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const OFFSCREEN_URL = 'capture-offscreen.html'

async function hasOffscreenDocument(): Promise<boolean> {
  if (!chrome.runtime.getContexts) return false
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  })
  return contexts.length > 0
}

export async function ensureCaptureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('Offscreen API unavailable')
  }
  if (await hasOffscreenDocument()) return

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_URL),
    reasons: ['USER_MEDIA'],
    justification: 'Record tab and microphone audio for meeting transcripts',
  })
}

export async function closeCaptureOffscreenDocumentIfIdle(): Promise<void> {
  if (!chrome.offscreen?.closeDocument) return
  if (!(await hasOffscreenDocument())) return

  const response = (await chrome.runtime.sendMessage({
    type: 'capture-audio-status',
  })) as { sessionIds?: string[] } | undefined
  if (response?.sessionIds?.length) return

  await chrome.offscreen.closeDocument()
}
