import type {
  ConsequenceClass,
  TrustPin,
} from '@browseros/shared/trust/consequence-class'

type PinsMap = Partial<Record<ConsequenceClass, TrustPin>>

export interface ConversationContext {
  pins: PinsMap
}

const store = new Map<string, ConversationContext>()

function ensure(conversationId: string): ConversationContext {
  let ctx = store.get(conversationId)
  if (!ctx) {
    ctx = { pins: {} }
    store.set(conversationId, ctx)
  }
  return ctx
}

export function setConversationPins(
  conversationId: string,
  pins: PinsMap,
): void {
  const ctx = ensure(conversationId)
  ctx.pins = pins
}

export function getConversationPins(conversationId: string): PinsMap {
  return store.get(conversationId)?.pins ?? {}
}

export function addConversationPin(
  conversationId: string,
  cls: ConsequenceClass,
): void {
  const ctx = ensure(conversationId)
  ctx.pins = { ...ctx.pins, [cls]: { pinned: true } }
}
