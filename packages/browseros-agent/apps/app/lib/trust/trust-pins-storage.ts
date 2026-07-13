import type { ConsequenceClass } from '@browseros/shared/trust/consequence-class'
import { storage } from '@wxt-dev/storage'

export interface TrustPinRecord {
  pinned: boolean
  expiresAt?: number
}

export type TrustPinsMap = Partial<Record<ConsequenceClass, TrustPinRecord>>

export const trustPinsStorage = storage.defineItem<TrustPinsMap>(
  'local:trust-pins',
  { fallback: {} },
)

export const PINNABLE_CLASSES = [
  'write-local',
  'system',
  'write-external',
  'spend',
] as const satisfies readonly ConsequenceClass[]

export type PinnableClass = (typeof PINNABLE_CLASSES)[number]

export type ConversationTrustMap = Record<
  string,
  Partial<Record<ConsequenceClass, boolean>>
>

export const conversationTrustStorage =
  storage.defineItem<ConversationTrustMap>('local:conversation-trust-pins', {
    fallback: {},
  })
