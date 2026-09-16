import { useCallback, useEffect, useRef, useState } from 'react'
import { stageAttachments } from '@/lib/attachments'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import { selectedTextStorage } from '@/lib/selected-text/selectedTextStorage'
import { sentry } from '@/lib/sentry/sentry'
import { useChatSessionContext } from './chat-session-context'
import { dispatchNextComposerMessage } from './composer-dispatch'
import {
  type ChatDraft,
  type ComposerState,
  composerKey,
  emptyComposer,
  emptyDraft,
  migrateComposer,
  readComposer,
  recoverComposer,
  updateComposer,
} from './composer-store'

export function useChatComposer() {
  const session = useChatSessionContext()
  const key = composerKey(
    session.conversationId,
    session.selectedProvider?.id ?? 'default',
  )
  const dispatchKey = `chat-dispatch:${session.conversationId}`
  const [loaded, setLoaded] = useState('')
  const [state, setState] = useState<ComposerState>(emptyComposer)
  const [error, setError] = useState<string>()
  const [preparing, setPreparing] = useState(false)
  const pendingWrites = useRef(new Map<string, number>())
  const stagingCount = useRef(0)
  const staging = useRef(Promise.resolve())
  const currentKey = useRef(key)
  currentKey.current = key
  const sessionRef = useRef(session)
  sessionRef.current = session
  const draftRef = useRef(state.draft)
  draftRef.current = state.draft
  const ready = loaded === key
  const [dispatchTick, setDispatchTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setDispatchTick((value) => value + 1), 2000)
    return () => clearInterval(timer)
  }, [])

  const report = useCallback((error: unknown) => {
    setError(
      error instanceof Error
        ? error.message
        : 'Could not save your draft. Try again.',
    )
    sentry.captureException(error)
  }, [])
  useEffect(() => {
    let live = true
    let observed: ComposerState | undefined
    setLoaded('')
    void navigator.locks
      .request(dispatchKey, { ifAvailable: true }, async (lock) => {
        await migrateComposer(session.conversationId)
        if (lock) await updateComposer(key, recoverComposer)
        return readComposer(key)
      })
      .then(async (next) => {
        const resolved = await next
        if (!live) return
        const latest =
          observed && (observed.revision ?? 0) >= (resolved.revision ?? 0)
            ? observed
            : resolved
        observed = latest
        setState(latest)
        setLoaded(key)
      })
      .catch(report)
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !changes[key]?.newValue || !live) return
      const incoming = changes[key].newValue as ComposerState
      if (observed && (incoming.revision ?? 0) < (observed.revision ?? 0))
        return
      observed = incoming
      setState((value) => ({
        ...incoming,
        draft:
          (pendingWrites.current.get(key) ?? 0) > 0
            ? value.draft
            : incoming.draft,
      }))
    }
    chrome.storage.onChanged.addListener(listener)
    return () => {
      live = false
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [key, dispatchKey, report, session.conversationId])

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          conversationId: string
          text: string
          tabs?: chrome.tabs.Tab[]
          attachments?: ChatDraft['attachments']
        }>
      ).detail
      if (detail.conversationId !== session.conversationId) return
      void updateComposer(key, (value) => ({
        ...value,
        draft: {
          text: [value.draft.text, detail.text].filter(Boolean).join('\n\n'),
          tabs: [
            ...value.draft.tabs,
            ...(detail.tabs ?? []).filter(
              (tab) =>
                !value.draft.tabs.some((existing) => existing.id === tab.id),
            ),
          ],
          attachments: [
            ...value.draft.attachments,
            ...(detail.attachments ?? []),
          ].slice(0, 10),
        },
      })).catch(report)
    }
    window.addEventListener('pane:chat-draft', listener)
    return () => window.removeEventListener('pane:chat-draft', listener)
  }, [key, session.conversationId, report])

  const change = (update: (value: ComposerState) => ComposerState) =>
    updateComposer(key, update).catch(report)
  function setDraft(update: (draft: ChatDraft) => ChatDraft) {
    if (!ready) return
    const next = update(draftRef.current)
    draftRef.current = next
    setState((value) => ({ ...value, draft: next }))
    pendingWrites.current.set(key, (pendingWrites.current.get(key) ?? 0) + 1)
    void updateComposer(key, (value) => ({
      ...value,
      draft: update(value.draft),
    }))
      .catch(report)
      .finally(() => {
        const remaining = (pendingWrites.current.get(key) ?? 1) - 1
        if (remaining) pendingWrites.current.set(key, remaining)
        else pendingWrites.current.delete(key)
      })
  }

  function addFiles(files: File[]) {
    if (!ready) return
    const attachmentKey = key
    stagingCount.current += 1
    setPreparing(true)
    staging.current = staging.current
      .then(async () => {
        const saved = await readComposer(attachmentKey)
        const result = await stageAttachments(
          files,
          saved.draft.attachments.length,
        )
        await updateComposer(attachmentKey, (value) => ({
          ...value,
          draft: {
            ...value.draft,
            attachments: [...value.draft.attachments, ...result.staged].slice(
              0,
              10,
            ),
          },
        }))
        if (currentKey.current === attachmentKey && result.errors.length)
          setError(result.errors.map((error) => error.message).join('\n'))
      })
      .catch(report)
      .finally(() => {
        stagingCount.current -= 1
        setPreparing(stagingCount.current > 0)
      })
  }

  async function submit() {
    if (!ready || preparing) return
    setError(undefined)
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const selectionMap = await selectedTextStorage.getValue()
      const selection = tabs[0]?.id
        ? (selectionMap[String(tabs[0].id)] ?? null)
        : null
      await updateComposer(key, (value) => {
        const draft = value.draft
        if (!draft.text.trim() && !draft.attachments.length) return value
        const message = {
          target: session.selectedProvider
            ? {
                id: session.selectedProvider.id,
                kind: session.selectedProvider.kind,
              }
            : undefined,
          text: draft.text.trim(),
          attachments: draft.attachments,
          mode: session.mode,
          action: createBrowserOSAction({
            mode: session.mode,
            message: draft.text.trim(),
            tabs: draft.tabs,
          }),
          selection,
        }
        return {
          ...value,
          draft: emptyDraft(),
          paused: value.queue.some((item) => item.state === 'review'),
          note: undefined,
          queue: [
            ...value.queue,
            {
              id: crypto.randomUUID(),
              message,
              state: 'queued',
              waitsForSuccess: session.isStreaming,
            },
          ],
        }
      })
    } catch (error) {
      report(error)
    }
  }

  // The dispatch lock spans the complete turn. A second panel can manage the
  // queue but cannot send it. Recovered 'sending' items are never auto-retried.
  useEffect(() => {
    void dispatchTick
    if (
      !ready ||
      state.paused ||
      !state.queue.length ||
      (!session.canSend && state.queue[0]?.state !== 'sending') ||
      session.isRestoringConversation
    )
      return
    const controller = new AbortController()
    void dispatchNextComposerMessage({
      key,
      dispatchKey,
      conversationId: session.conversationId,
      signal: controller.signal,
      isCurrent: () => currentKey.current === key,
      getSession: () => sessionRef.current,
    }).catch(report)
    return () => controller.abort()
  }, [
    key,
    dispatchKey,
    ready,
    state.paused,
    state.queue,
    dispatchTick,
    session.conversationId,
    session.canSend,
    session.isRestoringConversation,
    report,
  ])

  return {
    draftKey: key,
    state,
    ready,
    error,
    preparing,
    setDraft,
    addFiles,
    submit,
    dismissError: () => setError(undefined),
    pause: () =>
      change((value) => ({
        ...value,
        paused: true,
        note: 'Stopped. Send the remaining messages when you are ready.',
      })),
    resume: () =>
      change((value) => ({
        ...value,
        paused: false,
        note: undefined,
        queue: value.queue.map((item) => ({ ...item, waitsForSuccess: false })),
      })),
    remove: (id: string) =>
      change((value) => ({
        ...value,
        queue: value.queue.filter(
          (item) => item.id !== id || item.state === 'sending',
        ),
      })),
    edit: (id: string, text: string) =>
      change((value) => ({
        ...value,
        queue: value.queue.map((item) =>
          item.id === id && item.state !== 'sending'
            ? {
                ...item,
                message: {
                  ...item.message,
                  text,
                  action:
                    item.message.action?.type === 'browseros'
                      ? { ...item.message.action, message: text }
                      : item.message.action,
                },
                state: 'queued',
              }
            : item,
        ),
      })),
    move: (id: string, offset: number) =>
      change((value) => {
        const queue = [...value.queue]
        const index = queue.findIndex((item) => item.id === id)
        const to = index + offset
        if (
          index < 0 ||
          to < 0 ||
          to >= queue.length ||
          queue[index].state !== 'queued' ||
          queue[to].state !== 'queued'
        )
          return value
        ;[queue[index], queue[to]] = [queue[to], queue[index]]
        return { ...value, queue }
      }),
    restore: (id: string) =>
      change((value) => {
        const item = value.queue.find((item) => item.id === id)
        if (!item || item.state === 'sending') return value
        if (value.draft.text || value.draft.attachments.length)
          throw new Error(
            'Send or clear the current draft before restoring this message.',
          )
        return {
          ...value,
          draft: {
            text: item.message.text,
            tabs: item.message.action?.tabs ?? [],
            attachments: item.message.attachments ?? [],
          },
          queue: value.queue.filter((item) => item.id !== id),
        }
      }),
  }
}
export type ChatComposerController = ReturnType<typeof useChatComposer>
