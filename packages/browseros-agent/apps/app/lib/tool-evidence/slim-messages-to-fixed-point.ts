import type { UIMessage } from 'ai'
import { sentry } from '@/lib/sentry/sentry'
import { slimMessagesForClientUi } from './slim-messages-for-client-ui'
import { stripFatInlineImagesFromMessages } from './strip-inline-images'

/**
 * Re-applications allowed before giving up on reaching a fixed point. Well
 * above the 2-3 passes a legitimate multi-step transform needs to settle
 * (e.g. a truncation suffix whose own digit count needs one more pass of
 * re-truncating) — this loop runs synchronously inside a single effect
 * call, never across renders, so a generous cap is still cheap.
 */
const MAX_CONVERGENCE_ITERATIONS = 8

/**
 * Applies the client-side slimming pipeline repeatedly, in one call, until
 * the result stops changing by reference (or the iteration cap is hit).
 *
 * The caller feeds the result back into useChat's `messages` state from an
 * effect keyed on `messages` itself. If the pipeline were not a perfect
 * one-shot fixed point, that effect would re-fire on every render with a
 * "changed" result forever — non-convergence across renders is exactly
 * what caused React error #185 (Maximum update depth exceeded) in
 * production once already (see slim-messages-for-client-ui.ts history).
 * Looping to convergence *before* ever calling setState replaces "every
 * transform composed here must be provably idempotent in one application,
 * forever, by inspection" with a structural guarantee: at most one
 * setMessages call per real upstream `messages` change, ever — even a
 * future transform that regresses to non-convergent can only cost a
 * bounded, synchronous retry loop, never an unbounded cross-render one.
 */
export function slimMessagesToFixedPoint(
  messages: UIMessage[],
  // Injectable for tests that need to prove the cap/report behavior with a
  // deliberately non-convergent stub; production callers use the default.
  applyOnce: (msgs: UIMessage[]) => UIMessage[] = (msgs) =>
    slimMessagesForClientUi(stripFatInlineImagesFromMessages(msgs)),
): UIMessage[] {
  let current = messages
  for (let i = 0; i < MAX_CONVERGENCE_ITERATIONS; i++) {
    const next = applyOnce(current)
    if (next === current) return current
    current = next
  }
  sentry.captureException(
    new Error('slimMessagesToFixedPoint: pipeline did not converge'),
    { extra: { iterations: MAX_CONVERGENCE_ITERATIONS } },
  )
  return current
}
