import type {
  ConsequenceClass,
  TrustPin,
} from '@browseros/shared/trust/consequence-class'

type PinsMap = Partial<Record<ConsequenceClass, TrustPin>>

const store = new Map<string, PinsMap>()

export function setConversationPins(
  conversationId: string,
  pins: PinsMap,
): void {
  store.set(conversationId, pins)
}

export function getConversationPins(conversationId: string): PinsMap {
  return store.get(conversationId) ?? {}
}

export function addConversationPin(
  conversationId: string,
  cls: ConsequenceClass,
): void {
  const current = store.get(conversationId) ?? {}
  store.set(conversationId, { ...current, [cls]: { pinned: true } })
}
