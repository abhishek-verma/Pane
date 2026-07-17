/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getAgentServerUrl } from '@/lib/browseros/helpers'
import type {
  CaptureClass,
  CaptureSession,
} from '@/screens/capture/useCaptureApi'

const CAPTURE_API_TIMEOUT_MS = 15_000

async function baseUrl(): Promise<string> {
  return (await getAgentServerUrl()).replace(/\/$/, '')
}

async function captureApiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(CAPTURE_API_TIMEOUT_MS),
  })
}

export async function startMeetingSession(input: {
  tabId: number
  url: string
  title?: string
  bucketId?: string
}): Promise<CaptureSession> {
  const res = await captureApiFetch(
    `${await baseUrl()}/capture/meetings/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId: input.tabId,
        url: input.url,
        title: input.title,
        bucketId: input.bucketId ?? 'default',
      }),
    },
  )
  if (!res.ok) throw new Error(`capture start failed (${res.status})`)
  const json = (await res.json()) as { session: CaptureSession }
  return json.session
}

export async function fetchActiveMeetingSessions(): Promise<CaptureSession[]> {
  const res = await captureApiFetch(`${await baseUrl()}/capture/meetings`)
  if (!res.ok) throw new Error(`capture meetings failed (${res.status})`)
  const json = (await res.json()) as { sessions: CaptureSession[] }
  return json.sessions.filter((session) => session.status === 'active')
}

export async function stopMeetingSession(sessionId: string): Promise<void> {
  const res = await captureApiFetch(
    `${await baseUrl()}/capture/meetings/stop`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    },
  )
  if (!res.ok) throw new Error(`capture stop failed (${res.status})`)
}

export async function failMeetingSession(
  sessionId: string,
  message: string,
): Promise<void> {
  const res = await captureApiFetch(
    `${await baseUrl()}/capture/meetings/fail`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    },
  )
  if (!res.ok) throw new Error(`capture fail failed (${res.status})`)
}

export async function observeBrowsingPage(input: {
  url: string
  title?: string
  text: string
  bucketId?: string
}): Promise<void> {
  const res = await captureApiFetch(
    `${await baseUrl()}/capture/browsing/observe`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok && res.status !== 409) {
    throw new Error(`browsing observe failed (${res.status})`)
  }
}

export async function recordResearchPage(input: {
  url: string
  title?: string
  text: string
  threadId?: string
  topic?: string
  quote?: string
  bucketId?: string
}): Promise<void> {
  const res = await captureApiFetch(
    `${await baseUrl()}/capture/research/page`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`research page failed (${res.status})`)
}

export async function fetchCaptureConsents(bucketId?: string): Promise<
  Array<{
    domain: string
    class: CaptureClass
    bucketId: string
    allowed: boolean
  }>
> {
  const query = bucketId ? `?bucketId=${encodeURIComponent(bucketId)}` : ''
  const res = await captureApiFetch(
    `${await baseUrl()}/capture/consents${query}`,
  )
  if (!res.ok) throw new Error(`capture consents failed (${res.status})`)
  const json = (await res.json()) as {
    consents: Array<{
      domain: string
      class: CaptureClass
      bucketId: string
      allowed: boolean
    }>
  }
  return json.consents
}
