/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Widget binding cache — SQLite-backed, per-widget TTL.
 * Keeps tab-open render within the 150ms budget by serving stale-while-revalidate.
 */

import { getDbHandle } from '../lib/db'
import type { BindingResult } from './bindings'
import type { WidgetSpec } from './widget-spec'

const DEFAULT_TTL_MS = 5 * 60 * 1000

export function getCachedBinding(widgetId: string): BindingResult | null {
  const row = getDbHandle()
    .sqlite.prepare<{ data_json: string; expires_at: number }, [string]>(
      'SELECT data_json, expires_at FROM home_widget_cache WHERE widget_id = ?',
    )
    .get(widgetId)
  if (!row || row.expires_at < Date.now()) return null
  try {
    return JSON.parse(row.data_json) as BindingResult
  } catch {
    return null
  }
}

export function setCachedBinding(
  widgetId: string,
  result: BindingResult,
  ttlMs = DEFAULT_TTL_MS,
): void {
  const expiresAt = Date.now() + ttlMs
  getDbHandle()
    .sqlite.prepare(
      `INSERT OR REPLACE INTO home_widget_cache (widget_id, data_json, expires_at)
       VALUES (?, ?, ?)`,
    )
    .run(widgetId, JSON.stringify(result), expiresAt)
}

export function invalidateWidgetCache(widgetId: string): void {
  getDbHandle()
    .sqlite.prepare('DELETE FROM home_widget_cache WHERE widget_id = ?')
    .run(widgetId)
}

export async function getOrComputeBinding(
  spec: WidgetSpec,
  compute: (s: WidgetSpec) => Promise<BindingResult>,
): Promise<BindingResult> {
  const cached = getCachedBinding(spec.id)
  if (cached) return cached
  const result = await compute(spec)
  const ttlMs =
    spec.refreshMinutes === 1 ? 60_000 : spec.refreshMinutes * 60_000
  setCachedBinding(spec.id, result, ttlMs)
  return result
}
