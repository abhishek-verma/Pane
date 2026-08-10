/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Shared home payload types + fetch. Home open must never call /chat or LLM.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import type { PiHomeProjection } from '@/screens/personal-internet/types'
import { markHomeLoaderCalledChat } from './home-loader-guard'

export {
  homeLoaderCalledChat,
  resetHomeLoaderChatFlag,
} from './home-loader-guard'

export interface HomeGrowth {
  skillsLearned: number
  memoriesCount: number
  sitesActive: number
}

export interface HomeData {
  firstName?: string | null
  pi?: PiHomeProjection | null
  growth?: HomeGrowth
}

export const HOME_QUERY_KEY = ['scheduler', 'home'] as const

export async function fetchHome(): Promise<HomeData> {
  const base = await getAgentServerUrl()
  const url = `${base}/scheduler/home`
  if (url.includes('/chat')) markHomeLoaderCalledChat()
  const res = await agentFetch(url)
  if (!res.ok) throw new Error(`Home load failed: ${res.status}`)
  return res.json() as Promise<HomeData>
}
