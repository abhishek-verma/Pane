/**
 * Profile-aware lazy load for tool screenshots stored in ToolImageStore.
 *
 * Raw `<img src="/chat/.../tool-images/...">` cannot send
 * X-BrowserOS-Profile-Id, so thumbs 400 after profile isolation. Fetch via
 * agentFetch, cache a short-lived blob: URL, and revoke when the resident
 * message window drops the tool.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import {
  getCachedToolImageBlobUrl,
  setCachedToolImageBlobUrl,
} from './tool-media-cache'

export type ResolveToolImageArgs = {
  serverBaseUrl: string
  conversationId: string
  toolCallId: string
  signal?: AbortSignal
}

export function toolImageHttpUrl(args: {
  serverBaseUrl: string
  conversationId: string
  toolCallId: string
}): string {
  const base = args.serverBaseUrl.replace(/\/$/, '')
  return `${base}/chat/${encodeURIComponent(args.conversationId)}/tool-images/${encodeURIComponent(args.toolCallId)}`
}

/**
 * Returns a blob: object URL for the tool still. Cached per toolCallId;
 * callers must not revoke individually — use releaseMediaForMessages /
 * clearCachedToolImageBlobUrl.
 */
export async function resolveToolImageBlobUrl(
  args: ResolveToolImageArgs,
): Promise<string | null> {
  const cached = getCachedToolImageBlobUrl(args.toolCallId)
  if (cached) return cached

  const url = toolImageHttpUrl(args)
  const res = await agentFetch(url, { signal: args.signal })
  if (!res.ok) {
    throw new Error(`Failed to load tool image (${res.status})`)
  }
  const blob = await res.blob()
  if (args.signal?.aborted) return null

  // Another concurrent resolve may have won the race.
  const raced = getCachedToolImageBlobUrl(args.toolCallId)
  if (raced) {
    return raced
  }

  const objectUrl = URL.createObjectURL(blob)
  setCachedToolImageBlobUrl(args.toolCallId, objectUrl, blob.size)
  return objectUrl
}
