/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { UIMessage } from 'ai'
import type { SessionStore } from '../../agent/session-store'

function extractReplayText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    if ('text' in output && typeof output.text === 'string') {
      return output.text
    }
    if ('content' in output && Array.isArray(output.content)) {
      return output.content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: string }).text ?? '')
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
  }
  return JSON.stringify(output, null, 2)
}

/** Formats replay output the same way the sidepanel client does. */
export function formatReplayOutputForTool(
  toolName: string,
  output: unknown,
): unknown {
  const text = extractReplayText(output)
  const isError = Boolean((output as { isError?: boolean })?.isError)
  if (toolName.startsWith('filesystem_')) {
    return { text, isError }
  }
  return {
    content: [{ type: 'text', text }],
    isError,
  }
}

/**
 * Patches a tool part in the live session (if any) and persists to SQLite so
 * promote/replay does not leave the server transcript on dry-run output.
 */
export async function patchConversationToolOutput(
  sessionStore: SessionStore,
  conversationId: string,
  toolCallId: string,
  toolName: string,
  rawOutput: unknown,
  isError: boolean,
): Promise<boolean> {
  const live = sessionStore.get(conversationId)
  const current =
    live?.agent.messages ?? (await sessionStore.loadMessages(conversationId))
  if (current.length === 0) return false

  const output = formatReplayOutputForTool(toolName, rawOutput)
  let found = false
  const messages = current.map((message) => {
    if (!message.parts?.length) return message

    let changed = false
    const parts = message.parts.map((part) => {
      if (!part.type?.startsWith('tool-') && part.type !== 'dynamic-tool') {
        return part
      }
      const toolPart = part as { toolCallId?: string }
      if (toolPart.toolCallId !== toolCallId) return part
      found = true
      changed = true
      return {
        ...part,
        state: isError ? 'output-error' : 'output-available',
        output,
      }
    })

    return changed ? ({ ...message, parts } as UIMessage) : message
  })

  if (!found) return false

  if (live) {
    live.agent.messages = messages
  }
  await sessionStore.persistMessages(conversationId, messages)
  return true
}
