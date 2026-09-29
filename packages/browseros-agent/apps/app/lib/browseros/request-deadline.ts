/** Bound finite reads, including browser API setup and response-body parsing.
 * Streaming requests must keep their own lifetime instead.
 */
export async function withRequestDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  const timer = setTimeout(
    () =>
      controller.abort(new Error('Pane took too long to respond. Try again.')),
    options.timeoutMs ?? 15_000,
  )
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  let onAbort: () => void = () => {}
  try {
    controller.signal.throwIfAborted()
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
      }),
      read(controller.signal),
    ])
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
