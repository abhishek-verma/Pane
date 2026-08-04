/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tracks the single tab group each conversation's agent-opened tabs land
 * in, so a multi-tab task doesn't scatter tabs across the tab strip.
 */

import type { BrowserSession } from '@browseros/browser-core/core/session'
import { logger } from '../lib/logger'

const sessionTabGroups = new Map<string, string>()

/** Existing tab group id for this conversation, if a tab has already been grouped. */
export function getSessionTabGroupId(sessionId: string): string | undefined {
  return sessionTabGroups.get(sessionId)
}

/** Clears tracked group state, e.g. when a conversation is deleted. */
export function clearSessionTabGroup(sessionId: string): void {
  sessionTabGroups.delete(sessionId)
}

/**
 * Creates the conversation's tab group from its first agent-opened tab.
 * No-op if this conversation already has a group (later tabs join it via
 * `defaultTabGroupId` instead) or if grouping fails.
 */
export async function ensureSessionTabGroup(
  session: BrowserSession,
  sessionId: string,
  pageId: number,
): Promise<void> {
  if (sessionTabGroups.has(sessionId)) return

  const info = session.pages.getInfo(pageId)
  if (!info) return

  try {
    const { group } = (await session.cdp('Browser.createTabGroup', {
      tabIds: [info.tabId],
    })) as { group: { groupId: string } }
    sessionTabGroups.set(sessionId, group.groupId)
  } catch (error) {
    logger.warn('Failed to create session tab group', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
