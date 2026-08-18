import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { readSseFrames } from '@/lib/sse/read-sse-frames'

/**
 * Live dictation: a session-oriented sibling of transcribe-audio.ts's
 * one-shot flow. The caller registers a session up front, then feeds the
 * growing recording periodically while the user is still talking (getting
 * live captions over /events) instead of uploading once after they stop.
 */

export function createDictationSessionId(): string {
  return `dictation:${crypto.randomUUID()}`
}

export interface DictationEventsHandle {
  stop: () => void
}

export interface OpenDictationEventsOptions {
  onSegment: (cumulativeText: string) => void
  onError?: (message: string) => void
}

export function openDictationEvents(
  sessionId: string,
  options: OpenDictationEventsOptions,
): DictationEventsHandle {
  const controller = new AbortController()

  void (async () => {
    try {
      const serverUrl = await getAgentServerUrl()
      if (!serverUrl) return
      const response = await agentFetch(
        `${serverUrl}/capture/dictation/${sessionId}/events`,
        { signal: controller.signal },
      )
      if (!response.ok || !response.body) return
      for await (const frame of readSseFrames(response.body)) {
        if (frame.event !== 'segment') continue
        const data: { cumulative?: string } = JSON.parse(frame.data)
        if (data.cumulative) options.onSegment(data.cumulative)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      options.onError?.(err instanceof Error ? err.message : String(err))
    }
  })()

  return { stop: () => controller.abort() }
}

export interface PostDictationFeedOptions {
  force: boolean
  final: boolean
  signal?: AbortSignal
}

export async function postDictationFeed(
  sessionId: string,
  audioBlob: Blob,
  options: PostDictationFeedOptions,
): Promise<{ text?: string }> {
  const serverUrl = await getAgentServerUrl()
  if (!serverUrl) {
    throw new Error('Pane server is not running. Make sure Pane is open.')
  }

  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.webm')
  formData.append('force', String(options.force))
  formData.append('final', String(options.final))

  const response = await agentFetch(
    `${serverUrl}/capture/dictation/${sessionId}/feed`,
    { method: 'POST', body: formData, signal: options.signal },
  )
  const body: { error?: string; text?: string } = await response
    .json()
    .catch(() => ({ error: 'Dictation feed failed' }))
  if (!response.ok) {
    throw new Error(body.error ?? `Dictation feed failed: ${response.status}`)
  }
  return { text: body.text }
}

/** Best-effort: used from unmount/failure paths where nothing can react to a failure anyway. */
export async function cancelDictationSession(sessionId: string): Promise<void> {
  try {
    const serverUrl = await getAgentServerUrl()
    if (!serverUrl) return
    await agentFetch(`${serverUrl}/capture/dictation/${sessionId}`, {
      method: 'DELETE',
    })
  } catch {
    /* best-effort */
  }
}
