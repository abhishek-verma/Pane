import confetti from 'canvas-confetti'
import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'
import type { GlowMessage } from './GlowMessage'

const BUBBLE_ID = 'browseros-capture-bubble'
const BUBBLE_STYLES_ID = 'browseros-capture-bubble-styles'
const GLOW_OVERLAY_ID = 'browseros-glow-overlay'
const GLOW_STYLES_ID = 'browseros-glow-styles'

let activeConversationId: string | null = null
let activeCaptureSessionId: string | null = null
let activeMode: GlowMessage['mode'] = 'agent'

function injectBubbleStyles(): void {
  if (document.getElementById(BUBBLE_STYLES_ID)) return
  const style = document.createElement('style')
  style.id = BUBBLE_STYLES_ID
  style.textContent = `
    @keyframes browseros-bubble-in {
      from { opacity: 0; scale: 0.6; }
      to { opacity: 1; scale: 1; }
    }
    @keyframes browseros-bubble-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(251,102,24,0.4); }
      50% { box-shadow: 0 0 0 6px rgba(251,102,24,0); }
    }
    #${BUBBLE_ID} {
      position: fixed !important;
      top: 12px !important;
      right: 12px !important;
      width: 36px !important;
      height: 36px !important;
      border-radius: 50% !important;
      background: rgba(251,102,24,0.95) !important;
      color: white !important;
      border: 2px solid rgba(255,255,255,0.3) !important;
      cursor: grab !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      font-size: 0 !important;
      line-height: 1 !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      animation: browseros-bubble-in 200ms ease-out, browseros-bubble-pulse 2s ease-in-out infinite !important;
      transition: background 150ms ease, transform 100ms ease !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      touch-action: none !important;
    }
    #${BUBBLE_ID}:hover {
      background: rgba(220,60,20,1) !important;
      transform: scale(1.1) !important;
    }
    #${BUBBLE_ID}:active {
      cursor: grabbing !important;
    }
    #${BUBBLE_ID}[data-mode="agent"] {
      background: rgba(59,130,246,0.95) !important;
    }
    #${BUBBLE_ID}[data-mode="agent"]:hover {
      background: rgba(37,99,235,1) !important;
    }
    #${BUBBLE_ID} .browseros-bubble-tooltip {
      position: absolute !important;
      right: calc(100% + 8px) !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      background: rgba(0,0,0,0.8) !important;
      color: white !important;
      font-size: 11px !important;
      padding: 4px 8px !important;
      border-radius: 6px !important;
      white-space: nowrap !important;
      pointer-events: none !important;
      opacity: 0 !important;
      transition: opacity 150ms !important;
    }
    #${BUBBLE_ID}:hover .browseros-bubble-tooltip {
      opacity: 1 !important;
    }
  `
  const append = () => document.head.appendChild(style)
  if (document.head) append()
  else document.addEventListener('DOMContentLoaded', append, { once: true })
}

function createBubble(mode: GlowMessage['mode']): void {
  removeBubble()
  injectBubbleStyles()

  const bubble = document.createElement('button')
  bubble.id = BUBBLE_ID
  bubble.dataset.mode = mode ?? 'capture'
  bubble.setAttribute(
    'aria-label',
    mode === 'capture'
      ? 'Recording — click to stop'
      : 'Agent running — click to stop',
  )

  const icon =
    mode === 'capture'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="white"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>'
  bubble.innerHTML =
    icon +
    `<span class="browseros-bubble-tooltip">${mode === 'capture' ? 'Recording — click to stop' : 'Agent — click to stop'}</span>`

  let dragging = false
  let offsetX = 0
  let offsetY = 0
  let wasDragged = false

  bubble.addEventListener('click', (e) => {
    if (wasDragged) return
    e.preventDefault()
    if (mode === 'capture' && activeCaptureSessionId) {
      void sendRuntimeMessage(RuntimeMessageType.stopCapture, {
        sessionId: activeCaptureSessionId,
      })
    } else if (activeConversationId) {
      void sendRuntimeMessage(RuntimeMessageType.stopAgent, {
        conversationId: activeConversationId,
      })
    }
  })

  bubble.addEventListener('pointerdown', (e) => {
    dragging = true
    wasDragged = false
    offsetX = e.clientX - bubble.getBoundingClientRect().left
    offsetY = e.clientY - bubble.getBoundingClientRect().top
    bubble.setPointerCapture(e.pointerId)
    bubble.style.cursor = 'grabbing'
  })

  bubble.addEventListener('pointermove', (e) => {
    if (!dragging) return
    wasDragged = true
    const x = e.clientX - offsetX
    const y = e.clientY - offsetY
    bubble.style.right = 'auto'
    bubble.style.left = `${Math.max(0, Math.min(x, window.innerWidth - 36))}px`
    bubble.style.top = `${Math.max(0, Math.min(y, window.innerHeight - 36))}px`
  })

  bubble.addEventListener('pointerup', (e) => {
    dragging = false
    bubble.releasePointerCapture(e.pointerId)
    bubble.style.cursor = 'grab'
    setTimeout(() => {
      wasDragged = false
    }, 50)
  })

  const append = () => document.body.appendChild(bubble)
  if (document.body) append()
  else document.addEventListener('DOMContentLoaded', append, { once: true })
}

function removeBubble(): void {
  document.getElementById(BUBBLE_ID)?.remove()
}

function fireConfetti(): void {
  const colors = ['#fb6618', '#ff8a4c', '#fbbf24', '#34d399', '#60a5fa']
  const defaults = { colors, ticks: 200, gravity: 1.2, decay: 0.94 }

  confetti({
    ...defaults,
    particleCount: 80,
    spread: 70,
    origin: { x: 0.3, y: 0.6 },
    angle: 60,
  })
  confetti({
    ...defaults,
    particleCount: 80,
    spread: 70,
    origin: { x: 0.7, y: 0.6 },
    angle: 120,
  })

  setTimeout(() => {
    confetti({
      ...defaults,
      particleCount: 60,
      spread: 100,
      origin: { x: 0.5, y: 0.7 },
    })
  }, 150)

  setTimeout(() => {
    confetti({
      ...defaults,
      particleCount: 40,
      spread: 120,
      origin: { x: 0.4, y: 0.65 },
      angle: 75,
    })
    confetti({
      ...defaults,
      particleCount: 40,
      spread: 120,
      origin: { x: 0.6, y: 0.65 },
      angle: 105,
    })
  }, 350)
}

// Legacy glow removal (cleanup from older installs)
function stopLegacyGlow(): void {
  document.getElementById(GLOW_OVERLAY_ID)?.remove()
  document.getElementById(GLOW_STYLES_ID)?.remove()
}

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_start',
  main() {
    browser.runtime.onMessage.addListener(
      (message: GlowMessage, _sender, sendResponse) => {
        if (typeof message !== 'object' || !('isActive' in message)) {
          return
        }

        const mode = message.mode ?? 'agent'
        if (message.isActive) {
          activeMode = mode
          activeConversationId = message.conversationId ?? null
          activeCaptureSessionId = message.sessionId ?? null
          stopLegacyGlow()
          createBubble(mode)
        } else if (
          (mode === 'capture' &&
            message.sessionId === activeCaptureSessionId) ||
          (mode === 'agent' && message.conversationId === activeConversationId)
        ) {
          activeConversationId = null
          activeCaptureSessionId = null
          removeBubble()
          if (message.showConfetti) {
            fireConfetti()
          }
        }

        sendResponse({ success: true })
        return true
      },
    )

    window.addEventListener('beforeunload', removeBubble)

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && activeMode !== 'capture') {
        removeBubble()
      }
    })
  },
})
