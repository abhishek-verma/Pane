import type { ChatTurnController } from './chat-turn-controller'

/** Server liveness, not a change in response text, determines whether an
 * orphaned SDK stream can be detached. History hydration runs after SDK idle.
 */
export async function recoverStalledChat(options: {
  controller: Pick<
    ChatTurnController,
    'refreshActive' | 'hasResolvedActivity' | 'markInactive'
  >
  isCurrent: () => boolean
  stopSubscriber: () => void
}): Promise<void> {
  const { controller, isCurrent, stopSubscriber } = options
  const active = await controller.refreshActive()
  if (!isCurrent() || !controller.hasResolvedActivity) return
  if (active) return
  // Includes identical transcripts, tool-only replies, and empty failed turns.
  // None of those should keep the next user message waiting indefinitely.
  controller.markInactive()
  stopSubscriber()
}
