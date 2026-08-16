import { storage } from '@wxt-dev/storage'

interface MicLockRecord {
  ownerId: string
  heartbeatAt: number
}

// The side panel and the new-tab page are separate documents, each running
// its own independent voice hook with its own getUserMedia call and no
// other shared state between them. Without this, both could hold the
// microphone open at once with no in-app arbitration. session: storage is
// shared extension-wide (not per-document) and cleared on browser restart,
// which matches a lock that should never outlive the browser session.
const micLockStorage = storage.defineItem<MicLockRecord | null>(
  'session:browseros.voice.mic_lock',
  { fallback: null },
)

// An owner that stops renewing (tab closed without running its cleanup
// effect, crash) must not be able to hold the lock forever.
const STALE_MS = 15_000

export function createMicLockOwnerId(): string {
  return crypto.randomUUID()
}

/**
 * Best-effort, not atomic: acquiring is read-then-write, so two acquire
 * calls within the same few milliseconds could both see no lock and both
 * succeed. Both sides of that race are always the same person clicking one
 * mic control, so a genuine simultaneous double-click across two windows
 * isn't a realistic scenario worth a real distributed lock for.
 */
export async function acquireMicLock(ownerId: string): Promise<boolean> {
  const existing = await micLockStorage.getValue()
  const heldByOther =
    existing !== null &&
    existing.ownerId !== ownerId &&
    Date.now() - existing.heartbeatAt < STALE_MS
  if (heldByOther) return false
  await micLockStorage.setValue({ ownerId, heartbeatAt: Date.now() })
  return true
}

/** Call periodically (well under STALE_MS) while the mic stays open. */
export async function renewMicLock(ownerId: string): Promise<void> {
  const existing = await micLockStorage.getValue()
  if (existing?.ownerId !== ownerId) return
  await micLockStorage.setValue({ ownerId, heartbeatAt: Date.now() })
}

export async function releaseMicLock(ownerId: string): Promise<void> {
  const existing = await micLockStorage.getValue()
  if (existing?.ownerId !== ownerId) return
  await micLockStorage.setValue(null)
}

export const MIC_IN_USE_MESSAGE =
  'Microphone is in use in another Pane window. Close it there first.'
