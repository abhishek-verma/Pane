/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Refresh policy resolution + priority. A policy declares which trigger names
 * wake a page and which refresh kind (A–E) they run. Home has a built-in
 * reproject-only default; sites fall back to a cheap reproject default when
 * they have no stored policy.
 */

import { getPolicy } from '../store'
import type { PiRefreshKind, PiRefreshPolicy } from '../types'

export const DEFAULT_COOLDOWN_MS = 60_000

/** Stable id for the single per-profile home projection target. */
export const HOME_TARGET_ID = 'home'

/**
 * Drain priority — lower runs first. Time-bounded, user-visible refreshes beat
 * opportunistic harvest so a LinkedIn open never delays interview prep.
 */
export function triggerPriority(
  triggerName: string,
  kind?: PiRefreshKind,
): number {
  // Lower number = higher priority (drains first).
  if (triggerName === 'pre-event') return 0
  if (triggerName === 'manual-refresh') return 1
  if (triggerName === 'host-opened') return 6
  if (kind === 'A') return 2
  if (kind === 'B') return 3
  if (kind === 'D') return 4
  if (kind === 'E') return 5
  // Harvest (C) and other opportunistic triggers — run last.
  return 6
}

/** Home reprojects cheaply on lifecycle/site signals; it never harvests. */
export const HOME_DEFAULT_POLICY: PiRefreshPolicy = {
  triggers: [
    { name: 'browser-started', kind: 'A' },
    { name: 'new-day', kind: 'A' },
    { name: 'home-focused', kind: 'A' },
    { name: 'site-updated', kind: 'A' },
    { name: 'entity-mutated', kind: 'A' },
    { name: 'site-created', kind: 'A' },
    { name: 'site-archived', kind: 'A' },
    { name: 'run-completed', kind: 'A' },
    { name: 'meeting-ended', kind: 'A' },
    { name: 'pre-event', kind: 'A' },
    { name: 'manual-refresh', kind: 'A' },
  ],
  guards: { cooldownMs: DEFAULT_COOLDOWN_MS },
}

const SITE_DEFAULT_POLICY: PiRefreshPolicy = {
  triggers: [
    { name: 'entity-mutated', kind: 'A' },
    { name: 'site-updated', kind: 'A' },
    { name: 'new-day', kind: 'A' },
    { name: 'manual-refresh', kind: 'A' },
  ],
  guards: { cooldownMs: DEFAULT_COOLDOWN_MS },
}

export function resolveSitePolicy(siteId: string): PiRefreshPolicy {
  return getPolicy('site', siteId) ?? SITE_DEFAULT_POLICY
}

export function homePolicy(): PiRefreshPolicy {
  return getPolicy('home', HOME_TARGET_ID) ?? HOME_DEFAULT_POLICY
}

/**
 * Returns the refresh kinds a trigger fires under a policy. A trigger with a
 * `filter` (e.g. `host-opened: linkedin.com`) only matches when the event's
 * `filterValue` satisfies the filter, so one host open does not thrash every
 * page.
 */
export function matchTriggers(
  policy: PiRefreshPolicy,
  triggerName: string,
  filterValue?: string,
): PiRefreshKind[] {
  const kinds: PiRefreshKind[] = []
  for (const trigger of policy.triggers) {
    if (trigger.name !== triggerName) continue
    if (trigger.filter) {
      if (!filterValue || !filterValue.includes(trigger.filter)) continue
    }
    kinds.push(trigger.kind)
  }
  return kinds
}
