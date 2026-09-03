/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'
import { withRuntimeMessageTimeout } from './with-runtime-message-timeout'

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

  // On error or timeout (offscreen unresponsive) fall through to close: a
  // wedged offscreen document is exactly the case where forcibly tearing
  // down its context is the useful fallback — it releases the underlying
  // tab/mic capture handles even if in-page JS state never got there itself.
  const response = await withRuntimeMessageTimeout(
    sendRuntimeMessage(RuntimeMessageType.captureAudioStatus),
    TIMEOUTS.CAPTURE_STOP_MESSAGE,
  )
  if (response?.sessionIds?.length) return

  await chrome.offscreen.closeDocument()
}
