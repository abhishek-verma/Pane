import type {
  ConsequenceClass,
  GateContext,
  TrustPin,
} from '@browseros/shared/trust/consequence-class'
import { tryGetProfileKey } from '../lib/profile-context'
import type { PaneToolContext } from './pane-toolset'

type PinsMap = Partial<Record<ConsequenceClass, TrustPin>>

export interface ConversationContext {
  pins: PinsMap
  gateContext?: GateContext
  tools?: PaneToolContext
}

const store = new Map<string, ConversationContext>()

function key(conversationId: string): string {
  return JSON.stringify([tryGetProfileKey(), conversationId])
}

function ensure(conversationId: string): ConversationContext {
  let ctx = store.get(key(conversationId))
  if (!ctx) {
    ctx = { pins: {} }
    store.set(key(conversationId), ctx)
  }
  return ctx
}

export function setConversationPins(
  conversationId: string,
  pins: PinsMap,
): void {
  const ctx = ensure(conversationId)
  ctx.pins = pins
  if (ctx.gateContext) ctx.gateContext.pins = pins
}

export function getConversationPins(conversationId: string): PinsMap {
  const ctx = getConversationContext(conversationId)
  return ctx?.gateContext?.pins ?? ctx?.pins ?? {}
}

export function getConversationContext(conversationId: string) {
  return store.get(key(conversationId))
}

/** MCP and the in-process loop share the live policy, not a stale pin copy. */
export function setConversationContext(
  conversationId: string,
  gateContext: GateContext,
  tools: PaneToolContext,
): void {
  Object.assign(ensure(conversationId), {
    gateContext,
    tools,
    pins: gateContext.pins,
  })
}

export function addConversationPin(
  conversationId: string,
  cls: ConsequenceClass,
): void {
  const ctx = ensure(conversationId)
  ctx.pins = { ...ctx.pins, [cls]: { pinned: true } }
  if (ctx.gateContext) ctx.gateContext.pins = ctx.pins
}
