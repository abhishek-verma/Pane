import {
  conversationTrustStorage,
  PINNABLE_CLASSES,
  type PinnableClass,
  trustPinsStorage,
} from './trust-pins-storage'

/** A replayed, expired, denied, or orphaned approval never grants future trust. */
export async function persistApprovedTrust(input: {
  result: { ok: boolean; resumed: boolean; resolution?: string }
  scope: 'chat' | 'always'
  conversationId: string
  consequenceClass: string
}): Promise<boolean> {
  if (
    !input.result.ok ||
    !input.result.resumed ||
    input.result.resolution !== 'approved' ||
    !PINNABLE_CLASSES.includes(input.consequenceClass as PinnableClass)
  )
    return false
  const cls = input.consequenceClass as PinnableClass
  if (input.scope === 'always') {
    const pins = await trustPinsStorage.getValue()
    await trustPinsStorage.setValue({ ...pins, [cls]: { pinned: true } })
  }
  const conversations = await conversationTrustStorage.getValue()
  await conversationTrustStorage.setValue({
    ...conversations,
    [input.conversationId]: {
      ...conversations[input.conversationId],
      [cls]: true,
    },
  })
  return true
}
