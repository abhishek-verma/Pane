/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Harvest config helpers: normalize sources, rebuild refresh policy, propose
 * defaults, and build the structured harvest run prompt.
 */

import type { PiSiteRow } from '../lib/db/schema/personal-internet'
import type { PiRefreshPolicy, PiTemplateId } from './types'

export const MIN_HARVEST_CADENCE_DAYS = 1
export const MAX_HARVEST_CADENCE_DAYS = 30

export type HarvestConfig = {
  enabled: boolean
  sources: string[]
  cadenceDays: number
  instructions: string
  fromMeetings: boolean
  onHostOpened: boolean
  allowNavigate: boolean
  lastHarvestAt: number | null
}

export type ProposedHarvestConfig = {
  harvestEnabled: boolean
  harvestSources: string[]
  harvestCadenceDays: number
  harvestInstructions: string
  harvestFromMeetings: boolean
  harvestOnHostOpened: boolean
  harvestAllowNavigate: boolean
}

export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '')
}

export function normalizeHarvestSources(sources: unknown): string[] {
  if (!Array.isArray(sources)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of sources) {
    if (typeof raw !== 'string') continue
    const host = normalizeHost(raw)
    if (!host || seen.has(host)) continue
    seen.add(host)
    out.push(host)
  }
  return out
}

export function parseHarvestSourcesJson(
  json: string | null | undefined,
): string[] {
  if (!json) return []
  try {
    return normalizeHarvestSources(JSON.parse(json))
  } catch {
    return []
  }
}

export function clampCadenceDays(value: unknown, fallback = 1): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(
    MAX_HARVEST_CADENCE_DAYS,
    Math.max(MIN_HARVEST_CADENCE_DAYS, Math.floor(n)),
  )
}

export function harvestConfigFromSite(site: PiSiteRow): HarvestConfig {
  const sources = parseHarvestSourcesJson(site.harvestSourcesJson)
  const legacy =
    sources.length === 0 && site.harvestHost
      ? [normalizeHost(site.harvestHost)].filter(Boolean)
      : sources
  return {
    enabled: site.harvestEnabled === 1,
    sources: legacy,
    cadenceDays: clampCadenceDays(site.harvestCadenceDays, 1),
    instructions: site.harvestInstructions ?? '',
    fromMeetings: site.harvestFromMeetings === 1,
    onHostOpened: site.harvestOnHostOpened === 1,
    allowNavigate: site.harvestAllowNavigate === 1,
    lastHarvestAt: site.lastHarvestAt ?? null,
  }
}

/** Compat: first configured source (legacy harvest_host column). */
export function primaryHarvestHost(sources: string[]): string | null {
  return sources[0] ?? null
}

export function buildHarvestPolicy(config: HarvestConfig): PiRefreshPolicy {
  const triggers: PiRefreshPolicy['triggers'] = [
    { name: 'entity-mutated', kind: 'A' },
    { name: 'new-day', kind: 'D' },
    { name: 'manual-refresh', kind: 'A' },
  ]
  if (config.enabled && config.sources.length > 0 && config.onHostOpened) {
    for (const host of config.sources) {
      triggers.push({ name: 'host-opened', filter: host, kind: 'C' })
    }
  }
  // Scheduled cadence path — open-tab required unless allowNavigate (runner guard).
  if (config.enabled && config.sources.length > 0) {
    triggers.push({ name: 'harvest-due', kind: 'C' })
  }
  if (config.enabled && config.fromMeetings) {
    triggers.push({ name: 'meeting-ended', kind: 'C' })
  }
  return {
    triggers,
    guards: {
      cooldownMs: 60_000,
      requireHarvestEnabled: config.enabled,
    },
  }
}

export function proposeHarvestConfig(input: {
  name?: string
  jtbd?: string
  templateId?: PiTemplateId | string | null
}): {
  proposedConfig: ProposedHarvestConfig
  candidateHints: string[]
  rationale: string[]
} {
  const jtbd = (input.jtbd ?? '').toLowerCase()
  const templateId = input.templateId ?? null
  const involvesMeetings =
    /interview|meeting|call|sync|sales|outreach|pipeline|recruit/.test(jtbd) ||
    templateId === 'job-search' ||
    templateId === 'sales-leads'

  const candidateHints: string[] = []
  if (templateId === 'job-search') {
    candidateHints.push('linkedin.com', 'mail.google.com', 'greenhouse.io')
  } else if (templateId === 'sales-leads') {
    candidateHints.push('linkedin.com', 'mail.google.com')
  }

  const rationale = [
    'Sources stay empty until filled from conversation provenance (where the data came from).',
    'Cadence defaults to 1 day for browser sync.',
    involvesMeetings
      ? 'Meeting transcripts proposed on — this JTBD often benefits from call/interview context.'
      : 'Meeting transcripts proposed off — enable if calls should update this site.',
    'Host-opened and allow-navigate proposed on so sync can run when a source is open or on schedule without opening it today.',
  ]

  return {
    proposedConfig: {
      harvestEnabled: true,
      harvestSources: [],
      harvestCadenceDays: 1,
      harvestInstructions: '',
      harvestFromMeetings: involvesMeetings,
      harvestOnHostOpened: true,
      harvestAllowNavigate: true,
    },
    candidateHints,
    rationale,
  }
}

export function browserCadenceElapsed(
  config: HarvestConfig,
  nowMs: number = Date.now(),
): boolean {
  if (config.lastHarvestAt == null) return true
  const windowMs = config.cadenceDays * 24 * 60 * 60 * 1000
  return nowMs - config.lastHarvestAt >= windowMs
}

export function browserCadenceBucket(
  config: HarvestConfig,
  nowMs: number = Date.now(),
): string {
  const dayMs = 24 * 60 * 60 * 1000
  const dayIndex = Math.floor(nowMs / dayMs)
  const bucket = Math.floor(dayIndex / config.cadenceDays)
  return String(bucket)
}

export type HarvestPromptInput = {
  site: PiSiteRow
  triggerName: string
  filterValue?: string | null
  transcriptExcerpt?: string | null
  transcriptPath?: string | null
  openHosts?: string[] | null
  connectedMcps?: string[]
  records: Array<{ id: string; type: string; data: Record<string, unknown> }>
}

export function buildHarvestPrompt(input: HarvestPromptInput): string {
  return formatHarvestPrompt({
    site: input.site,
    config: harvestConfigFromSite(input.site),
    triggerName: input.triggerName,
    filterValue: input.filterValue,
    transcriptExcerpt: input.transcriptExcerpt,
    transcriptPath: input.transcriptPath,
    openHosts: input.openHosts,
    connectedMcps: input.connectedMcps ?? [],
    records: input.records,
  })
}

export function formatHarvestPrompt(input: {
  site: PiSiteRow
  config: HarvestConfig
  triggerName: string
  filterValue?: string | null
  transcriptExcerpt?: string | null
  transcriptPath?: string | null
  openHosts?: string[] | null
  connectedMcps: string[]
  records: Array<{ id: string; type: string; data: Record<string, unknown> }>
}): string {
  const { site, config, triggerName } = input
  const recordTypes = [...new Set(input.records.map((r) => r.type))]
  const fieldExamples: Record<string, string[]> = {}
  for (const r of input.records.slice(0, 20)) {
    if (!fieldExamples[r.type]) {
      fieldExamples[r.type] = Object.keys(r.data).slice(0, 12)
    }
  }

  const hostAlreadyOpen =
    Array.isArray(input.openHosts) &&
    config.sources.some((src) =>
      input.openHosts!.some(
        (h) => h === src || h.endsWith(`.${src}`) || normalizeHost(h) === src,
      ),
    )
  const mayNavigate =
    triggerName === 'meeting-ended'
      ? false
      : config.allowNavigate || hostAlreadyOpen || triggerName === 'host-opened'

  const domainSkill =
    site.templateId === 'job-search'
      ? 'pi-harvest-job-search (optional overlay for job-application fields)'
      : 'none (follow JTBD + existing record types)'

  const lines = [
    '## Role',
    'You are a background Personalised Internet sync agent for one site.',
    'Update pi_records from allowed sources/events. Do not chat with the user unless a tool requires approval.',
    '',
    '## Site',
    `siteId=${site.id}`,
    `name=${site.name}`,
    `slug=${site.slug}`,
    `templateId=${site.templateId ?? 'none'}`,
    `jtbd=${site.jtbd || '(none)'}`,
    '',
    '## Why this run',
    `trigger=${triggerName}`,
    `timestamp=${new Date().toISOString()}`,
    `cadenceDays=${config.cadenceDays}`,
    `lastHarvestAt=${config.lastHarvestAt ? new Date(config.lastHarvestAt).toISOString() : 'never'}`,
  ]

  if (triggerName === 'meeting-ended') {
    lines.push(`sessionId=${input.filterValue ?? ''}`)
    if (input.transcriptPath)
      lines.push(`transcriptPath=${input.transcriptPath}`)
    if (input.transcriptExcerpt) {
      lines.push('transcriptExcerpt:')
      lines.push(input.transcriptExcerpt.slice(0, 6000))
    }
  }

  lines.push(
    '',
    '## Confirmed harvest config (user-confirmed — not suggestions)',
    `enabled=${config.enabled}`,
    `sources=${JSON.stringify(config.sources)}`,
    `instructions=${config.instructions ? JSON.stringify(config.instructions) : 'none'}`,
    `fromMeetings=${config.fromMeetings}`,
    `onHostOpened=${config.onHostOpened}`,
    `allowNavigate=${config.allowNavigate}`,
    '',
    '## Capabilities for this run',
    `mayOpenOrNavigateSources=${mayNavigate ? 'yes' : 'no'}`,
    `sourcesInScope=${JSON.stringify(config.sources)}`,
    `connectedMcps=${input.connectedMcps.length ? JSON.stringify(input.connectedMcps) : 'none — use browser'}`,
    '',
    '## Data model for this site',
    `existingRecordTypes=${recordTypes.length ? JSON.stringify(recordTypes) : 'none yet — infer types from JTBD and custom instructions; do not assume job-application'}`,
    `exampleFieldKeys=${JSON.stringify(fieldExamples)}`,
    'Load skill pi-harvest (generic). Optional domain skill: ' + domainSkill,
    'Write path: pi_record_list → pi_record_upsert (or delete). Board/chart/pulse sync from records — do not hand-edit board JSON as source of truth.',
    '',
    '## Current records snapshot (use pi_record_list for more)',
    JSON.stringify(input.records.slice(0, 40)),
    '',
    '## User custom instructions',
    config.instructions.trim() ? config.instructions : 'none',
    '',
    '## Hard rules',
    '- Only use facts from configured sources, the meeting transcript (if this trigger), or existing records.',
    '- Never invent entities, companies, leads, or statuses.',
    '- If nothing relevant changed, make no writes and finish.',
    '- Stay within configured sources unless a listed MCP applies.',
    '- Respect mayOpenOrNavigateSources.',
    '- If a meeting transcript is irrelevant to this site JTBD, no-op.',
  )

  return lines.join('\n')
}
