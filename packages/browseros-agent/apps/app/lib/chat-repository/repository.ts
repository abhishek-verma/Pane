import type { UIMessage } from 'ai'
import type {
  ChatActiveTurnInfo,
  ChatTurnStreamEvent,
} from '../conversations/chat-turn-api'
import type {
  ChatSnapshot,
  PreparedChatRequest,
  RunEvent,
  RunResult,
} from './types'

interface Entry {
  state: ChatSnapshot
  listeners: Map<(state: ChatSnapshot) => void, boolean>
  touched: number
  probedAt?: number
  historyAt: number
  bytes: number
  refresh?: Promise<void>
  refreshHistory?: boolean
  load?: Promise<void>
  pendingMessages?: { messages: UIMessage[]; hasMore: boolean }
  hash?: string
  published?: ChatSnapshot
  generation: number
  stream?: AbortController
  execution?: AbortController
  settled?: Promise<void>
  resolveSettled?: () => void
  publishTimer?: ReturnType<typeof setTimeout>
}
export interface RepositoryBackend {
  configure?: (id: string, request: PreparedChatRequest) => Promise<void>
  history: (
    id: string,
    allowMissing: boolean,
  ) => Promise<{ messages: UIMessage[]; hasMore: boolean }>
  active: (id: string) => Promise<ChatActiveTurnInfo | null>
  attach: (
    id: string,
    turnId: string,
    signal: AbortSignal,
    event: (event: ChatTurnStreamEvent, seq: number) => void,
  ) => Promise<void>
  cancel: (id: string, reason?: string) => Promise<boolean>
  execute: (
    id: string,
    request: PreparedChatRequest,
    messages: UIMessage[],
    signal: AbortSignal,
    event: (event: RunEvent) => void | Promise<void>,
    snapshot: (messages: UIMessage[]) => void,
  ) => Promise<RunResult>
  project: (messages: UIMessage[]) => UIMessage[]
}

/** One instance per profile in the extension background. UI lifetimes never
 * own execution. Only replaceable transcript cache entries are evicted. */
export class ChatRepository {
  private entries = new Map<string, Entry>()
  constructor(
    private readonly backend: RepositoryBackend,
    private readonly options = {
      maxBytes: 32 * 1024 * 1024,
      idleMs: 5 * 60_000,
    },
  ) {}
  private entry(id: string): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        state: {
          conversationId: id,
          revision: 0,
          messages: [],
          hasMore: false,
          loaded: false,
          active: null,
          activityKnown: false,
          busy: false,
        },
        listeners: new Map(),
        touched: Date.now(),
        historyAt: 0,
        bytes: 0,
        generation: 0,
      }
      this.entries.set(id, entry)
    }
    entry.touched = Date.now()
    return entry
  }
  private publish(entry: Entry, immediate = false) {
    const emit = () => {
      entry.publishTimer = undefined
      if (entry.pendingMessages) {
        const pending = entry.pendingMessages
        entry.pendingMessages = undefined
        const projected = this.backend.project(pending.messages)
        const hash = JSON.stringify(projected)
        if (hash !== entry.hash) {
          entry.hash = hash
          entry.bytes = hash.length * 2
          entry.state = { ...entry.state, messages: projected }
        }
        entry.state = { ...entry.state, loaded: true, hasMore: pending.hasMore }
      }
      const old = entry.published,
        next = entry.state
      if (
        old &&
        old.messages === next.messages &&
        old.busy === next.busy &&
        old.loaded === next.loaded &&
        old.hasMore === next.hasMore &&
        old.error === next.error &&
        old.vmStatus === next.vmStatus &&
        old.activityKnown === next.activityKnown &&
        old.active?.turnId === next.active?.turnId
      )
        return
      entry.state = { ...entry.state, revision: entry.state.revision + 1 }
      entry.published = entry.state
      for (const [listener, visible] of entry.listeners)
        if (visible) listener(entry.state)
    }
    if (immediate) {
      if (entry.publishTimer) clearTimeout(entry.publishTimer)
      emit()
    } else if (!entry.publishTimer) entry.publishTimer = setTimeout(emit, 50)
  }
  private messages(
    entry: Entry,
    messages: UIMessage[],
    hasMore = entry.state.hasMore,
  ) {
    entry.pendingMessages = { messages, hasMore }
    this.publish(entry)
  }
  subscribe(
    id: string,
    listener: (state: ChatSnapshot) => void,
    visible = true,
  ) {
    const entry = this.entry(id)
    entry.listeners.set(listener, visible)
    if (visible) listener(entry.state)
    void this.refresh(id).catch(() => {})
    return {
      visibility: (value: boolean) => {
        entry.listeners.set(listener, value)
        entry.touched = Date.now()
        if (value) {
          listener(entry.state)
          void this.refresh(id, true).catch(() => {})
        } else this.releaseStream(entry)
      },
      dispose: () => {
        entry.listeners.delete(listener)
        entry.touched = Date.now()
        this.releaseStream(entry)
        this.sweep()
      },
    }
  }
  private releaseStream(entry: Entry) {
    if ([...entry.listeners.values()].some(Boolean) || entry.execution) return
    entry.stream?.abort()
    entry.stream = undefined
  }
  private async history(entry: Entry, strict = false) {
    if (entry.load) return entry.load
    const generation = entry.generation
    const before = entry.state.messages
    const pending = entry.pendingMessages
    const work = async () => {
      const page = await this.backend.history(
        entry.state.conversationId,
        !strict,
      )
      if (
        entry.generation !== generation ||
        entry.execution ||
        entry.state.messages !== before ||
        entry.pendingMessages !== pending
      )
        return
      entry.historyAt = Date.now()
      this.messages(entry, page.messages, page.hasMore)
      this.publish(entry, true)
    }
    entry.load = work()
    try {
      await entry.load
    } finally {
      entry.load = undefined
    }
  }
  async read(id: string) {
    const entry = this.entry(id)
    if (!entry.state.loaded) await this.history(entry, true)
    void this.refresh(id).catch(() => {})
    return entry.state
  }
  async reload(id: string) {
    const entry = this.entry(id)
    if (!entry.execution) await this.history(entry, true)
    void this.refresh(id).catch(() => {})
    return entry.state
  }
  async refresh(
    id: string,
    forceHistory = false,
    strict = false,
  ): Promise<void> {
    const entry = this.entry(id)
    if (entry.execution) return
    if (entry.refresh) {
      const includedHistory = entry.refreshHistory
      await entry.refresh
      if (forceHistory && !includedHistory)
        return this.refresh(id, true, strict)
      return
    }
    entry.refreshHistory = forceHistory
    const generation = entry.generation
    const current = () => generation === entry.generation && !entry.execution
    const work = async () => {
      try {
        entry.probedAt = Date.now()
        const active = await this.backend.active(id)
        if (!current()) return
        const wasActive = Boolean(entry.state.active)
        const previousTurnId = entry.state.active?.turnId
        entry.state = {
          ...entry.state,
          active,
          activityKnown: true,
          busy: active?.status === 'running',
          error: undefined,
        }
        // Probe before history; never replace a newer streamed snapshot with a
        // history request that began before that snapshot.
        if (active?.status === 'running') {
          if (previousTurnId !== active.turnId) {
            entry.stream?.abort()
            entry.stream = undefined
          }
          this.attach(entry, active)
          if (
            (!entry.state.loaded &&
              [...entry.listeners.values()].some(Boolean)) ||
            forceHistory
          )
            await this.history(entry, strict)
        } else {
          entry.stream?.abort()
          entry.stream = undefined
          if (
            forceHistory ||
            wasActive ||
            !entry.state.loaded ||
            Date.now() - entry.historyAt > 10_000
          ) {
            await this.history(entry, strict)
          }
        }
        this.publish(entry, true)
      } catch (error) {
        if (current()) {
          entry.state = { ...entry.state, error: String(error) }
          this.publish(entry, true)
        }
        throw error
      }
    }
    entry.refresh = work()
    try {
      await entry.refresh
    } finally {
      entry.refresh = undefined
    }
  }
  private attach(entry: Entry, active: ChatActiveTurnInfo) {
    if (
      entry.stream ||
      entry.execution ||
      ![...entry.listeners.values()].some(Boolean)
    )
      return
    const ac = new AbortController()
    entry.stream = ac
    let lastSeq = -1
    void this.backend
      .attach(
        entry.state.conversationId,
        active.turnId,
        ac.signal,
        (event, seq) => {
          if (
            ac.signal.aborted ||
            entry.stream !== ac ||
            entry.state.active?.turnId !== active.turnId
          )
            return
          if (seq >= 0 && seq <= lastSeq) return
          if (seq >= 0) lastSeq = seq
          if (event.type === 'snapshot') this.messages(entry, event.messages)
          else {
            entry.state = {
              ...entry.state,
              active: null,
              busy: false,
              activityKnown: true,
            }
            this.publish(entry, true)
          }
        },
      )
      .catch((error) => {
        if (!ac.signal.aborted) {
          entry.state = { ...entry.state, error: String(error) }
          this.publish(entry, true)
        }
      })
      .finally(() => {
        if (entry.stream === ac) entry.stream = undefined
      })
  }
  async configure(id: string, request: PreparedChatRequest) {
    await this.backend.configure?.(id, request)
  }
  async run(
    id: string,
    request: PreparedChatRequest,
    messages: UIMessage[],
    event: (event: RunEvent) => void | Promise<void> = () => {},
  ): Promise<RunResult> {
    const entry = this.entry(id)
    if (entry.execution || entry.state.busy)
      throw new Error(
        'This conversation already has a running turn. Queue the message instead.',
      )
    const ac = new AbortController()
    entry.execution = ac
    entry.settled = new Promise((resolve) => {
      entry.resolveSettled = resolve
    })
    entry.generation++
    entry.stream?.abort()
    entry.stream = undefined
    entry.state = {
      ...entry.state,
      busy: true,
      error: undefined,
      vmStatus: null,
    }
    this.messages(entry, messages)
    this.publish(entry, true)
    try {
      return await this.backend.execute(
        id,
        request,
        messages,
        ac.signal,
        (value) => {
          if (value.type === 'chunk' && value.chunk.type === 'data-vm-status') {
            const data = value.chunk.data as {
              status?: string
              progress?: string
            }
            entry.state = {
              ...entry.state,
              vmStatus:
                data.status === 'booting' || data.status === 'error'
                  ? { status: data.status, progress: data.progress }
                  : null,
            }
            this.publish(entry, true)
          }
          if (value.type === 'accepted') {
            entry.state = {
              ...entry.state,
              activityKnown: true,
              active: {
                turnId: value.turnId,
                conversationId: id,
                status: 'running',
                lastSeq: -1,
                startedAt: Date.now(),
                prompt: null,
                truncated: false,
              },
            }
            this.publish(entry, true)
          }
          return event(value)
        },
        (next) => {
          if (!ac.signal.aborted) this.messages(entry, next)
        },
      )
    } catch (error) {
      entry.state = { ...entry.state, error: String(error) }
      throw error
    } finally {
      entry.execution = undefined
      entry.resolveSettled?.()
      entry.resolveSettled = undefined
      entry.state = {
        ...entry.state,
        busy: false,
        active: null,
        vmStatus: null,
      }
      entry.historyAt = 0
      this.publish(entry, true)
      void this.refresh(id, true).catch(() => {})
      this.sweep()
    }
  }
  async recover(id: string, turnId: string): Promise<RunResult['outcome']> {
    const entry = this.entry(id)
    if (entry.execution) return 'pending'
    const ac = new AbortController()
    entry.execution = ac
    entry.settled = new Promise((resolve) => {
      entry.resolveSettled = resolve
    })
    entry.generation++
    entry.stream?.abort()
    entry.stream = undefined
    entry.state = { ...entry.state, busy: true }
    this.publish(entry, true)
    let outcome: RunResult['outcome'] = 'pending'
    try {
      await this.backend.attach(
        id,
        turnId,
        AbortSignal.any([ac.signal, AbortSignal.timeout(30_000)]),
        (event) => {
          if (event.type === 'snapshot') this.messages(entry, event.messages)
          else outcome = event.status === 'done' ? 'done' : 'paused'
        },
      )
      return outcome
    } catch {
      return 'pending'
    } finally {
      entry.execution = undefined
      entry.resolveSettled?.()
      entry.resolveSettled = undefined
      entry.state = {
        ...entry.state,
        busy: false,
        active: null,
        vmStatus: null,
      }
      this.publish(entry, true)
      void this.refresh(id, true).catch(() => {})
    }
  }
  async cancel(id: string, reason?: string) {
    const entry = this.entry(id)
    const cancellation = this.backend.cancel(id, reason)
    entry.execution?.abort()
    const [cancelled] = await Promise.all([cancellation, entry.settled])
    entry.stream?.abort()
    entry.stream = undefined
    entry.generation++
    entry.state = {
      ...entry.state,
      busy: false,
      active: null,
      activityKnown: true,
    }
    this.publish(entry, true)
    return cancelled
  }
  tick() {
    for (const [id, entry] of this.entries)
      if (
        !entry.execution &&
        ([...entry.listeners.values()].some(Boolean) ||
          (entry.state.busy && Date.now() - (entry.probedAt ?? 0) > 10_000))
      )
        void this.refresh(id).catch(() => {})
    this.sweep()
  }
  sweep(now = Date.now()) {
    let bytes = [...this.entries.values()].reduce(
      (total, entry) => total + entry.bytes,
      0,
    )
    const candidates = [...this.entries.entries()]
      .filter(
        ([, entry]) =>
          !entry.execution &&
          ![...entry.listeners.values()].some(Boolean) &&
          !entry.refresh &&
          !entry.load,
      )
      .sort((a, b) => a[1].touched - b[1].touched)
    for (const [id, entry] of candidates) {
      if (
        bytes <= this.options.maxBytes &&
        now - entry.touched < this.options.idleMs
      )
        continue
      entry.stream?.abort()
      if (entry.publishTimer) clearTimeout(entry.publishTimer)
      bytes -= entry.bytes
      // Hidden subscribers retain their subscription handle. Drop the payload,
      // not the handle; showing the view rehydrates this same entry.
      if (entry.listeners.size || entry.state.busy) {
        entry.state = { ...entry.state, messages: [], loaded: false }
        entry.bytes = 0
        entry.hash = undefined
        entry.published = undefined
        entry.pendingMessages = undefined
        entry.historyAt = 0
      } else this.entries.delete(id)
    }
  }
  setApprovalMessages(id: string, messages: UIMessage[]) {
    const entry = this.entry(id)
    if (entry.execution)
      throw new Error('A turn started before the approval was applied.')
    entry.generation++
    this.messages(entry, messages)
    this.publish(entry, true)
  }
  peek(id: string) {
    return this.entry(id).state
  }
  inspect() {
    return {
      entries: this.entries.size,
      bytes: [...this.entries.values()].reduce((n, e) => n + e.bytes, 0),
    }
  }
}
