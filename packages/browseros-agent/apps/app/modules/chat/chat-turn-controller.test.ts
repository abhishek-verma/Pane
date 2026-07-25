import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { ChatActiveTurnInfo } from '@/lib/conversations/chat-turn-api'

const fetchActiveChatTurn = mock(
  async (): Promise<ChatActiveTurnInfo | null> => null,
)
const cancelChatTurn = mock(async () => ({ cancelled: true }))
const attachChatTurnStream = mock(async () => {})

// Do not import the real chat-turn-api module here — it pulls wxt/storage.
mock.module('@/lib/conversations/chat-turn-api', () => ({
  fetchActiveChatTurn,
  cancelChatTurn,
  attachChatTurnStream,
}))

const { ChatTurnController } = await import('./chat-turn-controller')

afterAll(() => {
  mock.restore()
})

describe('ChatTurnController', () => {
  beforeEach(() => {
    fetchActiveChatTurn.mockReset()
    fetchActiveChatTurn.mockImplementation(async () => null)
    cancelChatTurn.mockReset()
    cancelChatTurn.mockImplementation(async () => ({ cancelled: true }))
    attachChatTurnStream.mockReset()
    attachChatTurnStream.mockImplementation(async () => {})
  })

  it('noteStartedTurn marks the turn active', () => {
    const controller = new ChatTurnController()
    let active = false
    controller.subscribe(({ isTurnActive }) => {
      active = isTurnActive
    })
    controller.noteStartedTurn('turn-1', 'conv-1')
    expect(controller.isTurnActive).toBe(true)
    expect(active).toBe(true)
  })

  it('detachAttachOnly does not clear active turn', () => {
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-1', 'conv-1')
    controller.detachAttachOnly()
    expect(controller.isTurnActive).toBe(true)
  })

  it('cancel clears active turn', async () => {
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-1', 'conv-1')
    await controller.cancel('user-stop')
    expect(controller.isTurnActive).toBe(false)
    expect(cancelChatTurn).toHaveBeenCalled()
  })

  it('markInactive clears liveness', () => {
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-1', 'conv-1')
    controller.markInactive()
    expect(controller.isTurnActive).toBe(false)
  })

  it('restoreAndAttach attaches when /active is running', async () => {
    fetchActiveChatTurn.mockImplementation(async () => ({
      turnId: 'turn-9',
      conversationId: 'conv-9',
      status: 'running' as const,
      lastSeq: 2,
      startedAt: Date.now(),
      prompt: null,
      truncated: false,
    }))
    const controller = new ChatTurnController()
    const ok = await controller.restoreAndAttach({
      conversationId: 'conv-9',
      onMessages: () => {},
    })
    expect(ok).toBe(true)
    expect(controller.isTurnActive).toBe(true)
    expect(attachChatTurnStream).toHaveBeenCalled()
  })

  it('refreshActive stays busy only while server reports running', async () => {
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-1', 'conv-1')
    fetchActiveChatTurn.mockImplementation(async () => null)
    const still = await controller.refreshActive()
    expect(still).toBe(false)
    expect(controller.isTurnActive).toBe(false)
  })

  it('refreshActive keeps prior liveness when the probe throws', async () => {
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-1', 'conv-1')
    fetchActiveChatTurn.mockImplementation(async () => {
      throw new Error('network')
    })
    const still = await controller.refreshActive()
    expect(still).toBe(true)
    expect(controller.isTurnActive).toBe(true)
  })

  it('refreshActive does not re-notify when the same turn is still running', async () => {
    fetchActiveChatTurn.mockImplementation(async () => ({
      turnId: 'turn-1',
      conversationId: 'conv-1',
      status: 'running' as const,
      lastSeq: 5,
      startedAt: Date.now(),
      prompt: null,
      truncated: false,
    }))
    const controller = new ChatTurnController()
    let notifications = 0
    controller.subscribe(() => {
      notifications += 1
    })
    controller.noteStartedTurn('turn-1', 'conv-1')
    const afterStart = notifications
    await controller.refreshActive()
    expect(notifications).toBe(afterStart)
  })

  it('refreshActive ignores a late probe after conversation switch', async () => {
    let resolveProbe: (value: ChatActiveTurnInfo) => void
    fetchActiveChatTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve
        }),
    )
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-a', 'conv-a')
    const probe = controller.refreshActive()
    controller.setConversationId('conv-b')
    resolveProbe!({
      turnId: 'turn-a',
      conversationId: 'conv-a',
      status: 'running',
      lastSeq: 1,
      startedAt: Date.now(),
      prompt: null,
      truncated: false,
    })
    expect(await probe).toBe(false)
    expect(controller.isTurnActive).toBe(false)
  })

  it('cancel does not clear a newer turn started while cancel was in flight', async () => {
    let resolveCancel: (value: { cancelled: boolean }) => void
    cancelChatTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    const controller = new ChatTurnController()
    controller.noteStartedTurn('turn-old', 'conv-1')
    const cancelPromise = controller.cancel('superseded-by-new-message')
    controller.noteStartedTurn('turn-new', 'conv-1')
    resolveCancel!({ cancelled: true })
    await cancelPromise
    expect(controller.isTurnActive).toBe(true)
    expect(controller.turn?.turnId).toBe('turn-new')
  })
})
