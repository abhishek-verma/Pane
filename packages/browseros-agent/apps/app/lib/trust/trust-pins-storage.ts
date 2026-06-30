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
] as const satisfies readonly ConsequenceClass[]

export type PinnableClass = (typeof PINNABLE_CLASSES)[number]
