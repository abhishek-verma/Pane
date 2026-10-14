/** Background followers need no transcript stream. The server and the SDK's
 * starter stream keep running; becoming visible always refreshes history. */
export function startVisibleChatFollower(options: {
  document: Pick<
    Document,
    'hidden' | 'addEventListener' | 'removeEventListener'
  >
  check: (context: {
    isCurrent: () => boolean
    resumed: boolean
  }) => Promise<void>
  detach: () => void
  intervalMs?: number
}): () => void {
  let disposed = false
  let checking = false
  let generation = 0
  let resumed = true
  const check = async () => {
    if (disposed || options.document.hidden || checking) return
    checking = true
    const epoch = generation
    const wasResumed = resumed
    resumed = false
    try {
      await options.check({
        isCurrent: () =>
          !disposed && !options.document.hidden && epoch === generation,
        resumed: wasResumed,
      })
    } catch {
      // A transient request failure is retried on the next visible poll.
    } finally {
      checking = false
      if (!disposed && generation !== epoch) void check()
    }
  }
  const onVisibility = () => {
    generation += 1
    resumed = true
    if (options.document.hidden) options.detach()
    else void check()
  }
  options.document.addEventListener('visibilitychange', onVisibility)
  const timer = setInterval(() => void check(), options.intervalMs ?? 2000)
  void check()
  return () => {
    disposed = true
    generation += 1
    clearInterval(timer)
    options.document.removeEventListener('visibilitychange', onVisibility)
    options.detach()
  }
}
