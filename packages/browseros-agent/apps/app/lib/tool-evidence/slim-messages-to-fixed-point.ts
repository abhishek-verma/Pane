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
 * Looping to convergence *before* ever calling setState turns "every
 * transform composed here must be provably idempotent in one application,
 * forever, by inspection" into "gets a few free retries automatically."
 *
 * On hitting the cap without converging, this returns the *original*
 * `messages` reference unchanged (not the still-diverging best-effort
 * result) — so the caller's reference check sees "no change" and skips
 * setMessages for this render. Returning the best-effort result instead
 * would still differ from the input, still trigger a setMessages call, and
 * still reproduce the cross-render loop this exists to prevent, just at
 * 1/8th the frequency; giving up and freezing at the last known-good value
 * is what actually makes non-convergence cost at most one Sentry report
 * instead of an unbounded render loop.
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
  return messages
}
