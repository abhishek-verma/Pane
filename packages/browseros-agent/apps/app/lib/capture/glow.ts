/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { GlowMessage } from '@/entrypoints/glow.content/GlowMessage'

export function sendTabGlow(tabId: number, message: GlowMessage): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {})
}

export function activateCaptureGlow(input: {
  tabId: number
  sessionId: string
  captureClass?: GlowMessage['captureClass']
}): void {
  sendTabGlow(input.tabId, {
    isActive: true,
    mode: 'capture',
    sessionId: input.sessionId,
    captureClass: input.captureClass ?? 'meeting',
  })
}

export function deactivateCaptureGlow(tabId: number, sessionId: string): void {
  sendTabGlow(tabId, {
    isActive: false,
    mode: 'capture',
    sessionId,
  })
}
