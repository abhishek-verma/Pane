/** Completion belongs to the conversation, including turns executed by the
 * background queue while this view's SDK remains ready. */
export class ChatCompletionTracker {
  private previous?: { conversationId: string; busy: boolean }

  update(input: {
    conversationId: string
    status: 'ready' | 'submitted' | 'streaming' | 'error'
    repositoryBusy: boolean
  }): boolean {
    const busy =
      input.repositoryBusy ||
      input.status === 'submitted' ||
      input.status === 'streaming'
    const completed =
      this.previous?.conversationId === input.conversationId &&
      this.previous.busy &&
      !busy &&
      input.status === 'ready'
    this.previous = { conversationId: input.conversationId, busy }
    return Boolean(completed)
  }
}
