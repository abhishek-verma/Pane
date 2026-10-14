/** Synthetic UI around production chat transport/projection/markdown and Layer runtime.
 * No user data, providers, real tools, installed extensions or profile state. */

import type { UIMessage } from 'ai'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMarkdown } from '../../../apps/app/components/tool-evidence/ChatMarkdown'
import { ManagedLayerRuntime } from '../../../apps/app/lib/layers/runtime'
import { slimMessagesForClientUi } from '../../../apps/app/lib/tool-evidence/slim-messages-for-client-ui'
import { ChatTurnController } from '../../../apps/app/modules/chat/chat-turn-controller'
import { startVisibleChatFollower } from '../../../apps/app/modules/chat/visible-chat-follower'

const root = globalThis as any
const params = new URL(location.href).searchParams
root.stats = {
  applies: 0,
  projectionMs: 0,
  reconciles: 0,
  inputPaintMs: [] as number[],
  longTasks: 0,
  longTaskMs: 0,
}
new PerformanceObserver((list) => {
  for (const item of list.getEntries()) {
    root.stats.longTasks++
    root.stats.longTaskMs += item.duration
  }
}).observe({ type: 'longtask', buffered: true })
if (params.get('kind') === 'web') {
  document.querySelector('main')!.innerHTML = Array.from(
    { length: 5000 },
    (_, i) => `<section id="row-${i}"><p>Row ${i}</p></section>`,
  ).join('')
  const mode = params.get('layers')!
  const runtime = new ManagedLayerRuntime(document, {
    status: () => {
      root.stats.reconciles++
    },
  })
  const count = mode === 'heavy' ? 5 : 1
  const layers = Array.from({ length: count }, (_, layer) => ({
    id: `test-${layer}`,
    version: 'a'.repeat(64),
    definition: {
      protocol: 'pane.layers.v1',
      name: 'Fixture',
      intent: 'Performance test',
      mode: 'managed',
      scope: {
        origin:
          mode === 'nonmatching'
            ? 'https://not-applicable.invalid'
            : location.origin,
        paths: ['/*'],
        excludePaths: [],
        query: {},
      },
      actions: [],
      operations: Array.from({ length: 20 }, (_, i) => ({
        id: `op-${i}`,
        kind: 'highlight',
        anchor: {
          selector:
            mode === 'heavy'
              ? `section:has(p):nth-child(${(layer * 20 + i) * 40 + 1})`
              : `#row-${(layer * 20 + i) * 40}`,
          maxMatches: 1,
        },
      })),
    },
  }))
  runtime.update(mode === 'off' ? [] : (layers as never))
  let tick = 0
  const timer = setInterval(() => {
    for (let i = 0; i < 30; i++)
      document.querySelector(`#row-${i} p`)!.textContent =
        `Row ${i} tick ${tick}`
    tick++
  }, 50)
  root.dispose = () => {
    clearInterval(timer)
    runtime.dispose()
  }
} else {
  let publish: (messages: UIMessage[]) => void
  function App() {
    const [messages, setMessages] = useState<UIMessage[]>([])
    const [draft, setDraft] = useState('')
    publish = setMessages
    return (
      <>
        <input
          id="composer"
          value={draft}
          onChange={(event) => {
            const at = performance.now()
            setDraft(event.target.value)
            requestAnimationFrame(() =>
              root.stats.inputPaintMs.push(performance.now() - at),
            )
          }}
        />
        <article>
          {messages.slice(-6).map((message) => (
            <ChatMarkdown
              key={message.id}
              text={message.parts
                .filter((p) => p.type === 'text')
                .map((p) => (p as any).text)
                .join('\n')}
              isStreaming={message.id === 'live'}
              segmentKey={message.id}
            />
          ))}
        </article>
      </>
    )
  }
  createRoot(document.querySelector('main')!).render(<App />)
  const id = params.get('chat')!
  const controller = new ChatTurnController()
  controller.setConversationId(id)
  let disposed = false,
    lastHistory = 0,
    historySnapshot = ''
  const apply = (messages: UIMessage[]) => {
    if (disposed) return
    const at = performance.now()
    const projected = slimMessagesForClientUi(messages)
    root.stats.projectionMs += performance.now() - at
    root.stats.applies++
    root.lastMessages = projected
    publish(projected)
  }
  // Mirror the production follower's 2s liveness / 10s idle-history cadence.
  // The controller, SSE parser, UI projection and markdown below are unmodified.
  const check = async ({
    isCurrent,
    resumed,
  }: {
    isCurrent: () => boolean
    resumed: boolean
  }) => {
    if (disposed || !isCurrent()) return
    if (resumed) lastHistory = 0
    {
      const wasActive = controller.isTurnActive
      const active = await controller.refreshActive()
      if (disposed || !isCurrent()) return
      if (active) controller.ensureAttached(apply)
      else if (wasActive || Date.now() - lastHistory > 10000) {
        const page = await (await fetch(`/chat/${id}/messages`)).json()
        lastHistory = Date.now()
        if (!isCurrent()) return
        const serialized = JSON.stringify(page.messages)
        if (serialized !== historySnapshot) {
          historySnapshot = serialized
          apply(page.messages)
        }
      }
    }
  }
  const stop = startVisibleChatFollower({
    document,
    check,
    detach: () => controller.detachAttachOnly(),
  })
  root.dispose = () => {
    disposed = true
    stop()
  }
}
root.ready = true
