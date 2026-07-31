/**
 * Pure LiveWatch frame helpers — single blob URL lifecycle so high-rate
 * JPEG streams cannot flood V8 with stacked data: URLs or base64 in React.
 */

/** Floor between committed frames — bounds decode + React work under flood. */
export const LIVE_WATCH_MIN_FRAME_INTERVAL_MS = 100
/** If an rAF callback is this late, drop the pending frame (event-loop lag). */
export const LIVE_WATCH_LAG_DROP_MS = 50
/** Connected without a fresh frame for this long → background/sparse hint. */
export const LIVE_WATCH_SPARSE_FRAME_MS = 2_500

export function jpegBase64ToBlobUrl(jpegBase64: string): string | null {
  try {
    const binary = atob(jpegBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  } catch {
    return null
  }
}

/**
 * Replace the previous live blob URL with a new JPEG frame.
 * Always revokes the previous URL so only one live bitmap is retained.
 */
export function replaceLiveWatchBlobUrl(
  previousUrl: string | null,
  jpegBase64: string,
): string | null {
  const nextUrl = jpegBase64ToBlobUrl(jpegBase64)
  if (!nextUrl) return previousUrl
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  return nextUrl
}

export function shouldCommitLiveWatchFrame(args: {
  now: number
  lastCommitAt: number
  rafScheduledAt: number
  minIntervalMs?: number
  lagDropMs?: number
}): 'commit' | 'wait_interval' | 'drop_lag' {
  const minInterval = args.minIntervalMs ?? LIVE_WATCH_MIN_FRAME_INTERVAL_MS
  const lagDrop = args.lagDropMs ?? LIVE_WATCH_LAG_DROP_MS
  if (args.now - args.rafScheduledAt > lagDrop) return 'drop_lag'
  if (args.now - args.lastCommitAt < minInterval) return 'wait_interval'
  return 'commit'
}

export function isLiveWatchSparse(args: {
  status: string
  hasBlob: boolean
  lastFrameAt: number | null
  now: number
  sparseMs?: number
}): boolean {
  if (args.status !== 'connected') return false
  if (!args.hasBlob) return true
  if (args.lastFrameAt == null) return true
  const sparseAfter = args.sparseMs ?? LIVE_WATCH_SPARSE_FRAME_MS
  return args.now - args.lastFrameAt >= sparseAfter
}
