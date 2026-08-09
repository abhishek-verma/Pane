/**
 * A single dispatched search action (one click on Refresh/Fix/send) can be
 * delivered to the panel's storage watcher twice — searchActionsStorage's
 * getValue() (mount-time read) and watch() (change notification) can both
 * resolve for the same write, and the background script deliberately writes
 * the same payload twice ("re-write so an already-mounted panel's watch()
 * fires"). Dedupe by a per-dispatch requestId, not by content: a content
 * fingerprint that gets reset after each apply reopens the exact race this
 * is meant to close (see chat-session.hooks.ts's applySearchAction).
 */
export function shouldApplySearchAction(input: {
  requestId: string
  lastAppliedRequestId: string | null
}): boolean {
  return input.requestId !== input.lastAppliedRequestId
}
