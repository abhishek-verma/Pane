/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Polls meeting tabs for active-speaker UI signals during capture.
 */

import {
  type ActiveSpeakerObservation,
  correlateMicSelfBoost,
  genericAdapter,
  getAdapterForHost,
} from '@browseros/capture/adapters'
import { postSpeakerObservation } from '@/lib/capture/capture-api'
import { getMeetingTabActiveSpeaker } from '@/lib/capture/meeting-in-call'
import { isRecording } from '@/lib/capture/tab-audio'
import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'

/**
 * Speaker DOM stamps are disabled after dogfood — labels were unreliable.
 * Keep this module so we can re-enable without rewiring the bridge.
 */
export const SPEAKER_LABELS_ENABLED = false

const POLL_MS = 850
const HEARTBEAT_MS = 2_000

type PollEntry = {
  sessionId: string
  tabId: number
  timer: ReturnType<typeof setInterval>
  lastKey: string | null
  lastPostedAt: number
}

const polls = new Map<string, PollEntry>()

function observationKey(obs: ActiveSpeakerObservation): string {
  return `${obs.displayName}\0${obs.isLocalSelf ? '1' : '0'}`
}

async function readLocalSpeaking(sessionId: string): Promise<boolean> {
  try {
    const res = await sendRuntimeMessage(
      RuntimeMessageType.captureMicSpeaking,
      {
        sessionId,
      },
    )
    return Boolean(res?.localSpeaking)
  } catch {
    return false
  }
}

async function tick(sessionId: string, tabId: number): Promise<void> {
  if (!isRecording(sessionId)) {
    stopSpeakerPoll(sessionId)
    return
  }
  const result = await getMeetingTabActiveSpeaker(tabId).catch(() => null)
  if (!result) return

  const adapter =
    getAdapterForHost(result.probe.hostname) ??
    (result.adapterId === 'generic' ? genericAdapter : null)
  if (!adapter?.capabilities.includes('speakerLabels')) return

  const localSpeaking = await readLocalSpeaking(sessionId)
  let obs = result.observation
  // Mic boost fills gaps; do not override high-confidence caption names.
  if (
    obs &&
    localSpeaking &&
    obs.source !== 'caption-row' &&
    obs.confidence < 0.9
  ) {
    const boosted = correlateMicSelfBoost({
      displayName: obs.displayName,
      isLocalSelf: obs.isLocalSelf,
      confidence: obs.confidence,
      localSpeaking,
      selfName: result.probe.facts.selfName,
    })
    obs = {
      ...obs,
      displayName: boosted.displayName,
      isLocalSelf: boosted.isLocalSelf,
      confidence: boosted.confidence,
    }
  } else if (!obs && localSpeaking && result.probe.facts.selfName) {
    obs = {
      displayName: result.probe.facts.selfName,
      isLocalSelf: true,
      confidence: 0.75,
      observedAt: Date.now(),
      source: 'dom-active',
    }
  }
  if (!obs || obs.confidence < 0.6 || !obs.displayName.trim()) return

  const entry = polls.get(sessionId)
  if (!entry) return

  const key = observationKey(obs)
  const now = Date.now()
  const changed = entry.lastKey !== key
  const heartbeat = now - entry.lastPostedAt >= HEARTBEAT_MS
  if (!changed && !heartbeat) return

  entry.lastKey = key
  entry.lastPostedAt = now
  const participants = adapter.probeParticipants?.(result.probe)
  await postSpeakerObservation(sessionId, {
    displayName: obs.displayName,
    isLocalSelf: obs.isLocalSelf,
    confidence: obs.confidence,
    observedAt: obs.observedAt,
    source: obs.source,
    localSpeaking,
    ...(participants && participants.length > 0 ? { participants } : {}),
  }).catch(() => null)
}

export function startSpeakerPoll(sessionId: string, tabId: number): void {
  if (!SPEAKER_LABELS_ENABLED) {
    stopSpeakerPoll(sessionId)
    return
  }
  stopSpeakerPoll(sessionId)
  const timer = setInterval(() => {
    void tick(sessionId, tabId)
  }, POLL_MS)
  polls.set(sessionId, {
    sessionId,
    tabId,
    timer,
    lastKey: null,
    lastPostedAt: 0,
  })
  void tick(sessionId, tabId)
}

export function stopSpeakerPoll(sessionId: string): void {
  const entry = polls.get(sessionId)
  if (!entry) return
  clearInterval(entry.timer)
  polls.delete(sessionId)
}

export function stopAllSpeakerPolls(): void {
  for (const id of [...polls.keys()]) stopSpeakerPoll(id)
}
