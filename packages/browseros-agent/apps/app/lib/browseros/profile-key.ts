/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Resolves a stable per-Chrome-profile key for agent-server data isolation.
 * Prefers the browser-owned metrics client id; falls back to a UUID in
 * chrome.storage.local when the pref is unavailable (dev / non-BrowserOS).
 */

import { storage } from '@wxt-dev/storage'
import { getBrowserOSAdapter, PrefApiUnavailableError } from './adapter'
import { BROWSEROS_PREFS } from './prefs'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const browserProfileKeyStorage = storage.defineItem<string | null>(
  'local:browserProfileKey',
  { fallback: null },
)

/**
 * Grace period for a genuinely-transient 'unavailable' probe (the pref API
 * exists but hasn't produced a valid id yet) before giving up and caching
 * the fallback anyway. The brand-new-profile race this covers resolves
 * within the first call or two in practice; this bound exists for the
 * other way 'unavailable' can happen — a permanently misconfigured pref on
 * a real BrowserOS install, not just early-boot timing — which would
 * otherwise re-probe forever on a hot path (agentFetch calls this per
 * request).
 */
const TRANSIENT_GRACE_MS = 60_000

let cachedKey: string | null = null
let inFlight: Promise<string> | null = null
let firstTransientProbeAt: number | null = null

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

type ProfileKeyProbe =
  | { status: 'resolved'; value: string }
  /** chrome.browserOS.getPref doesn't exist at all — permanent for this page (dev / non-BrowserOS). */
  | { status: 'absent' }
  /** API exists but hasn't produced a valid id yet — may resolve on a later call. */
  | { status: 'unavailable' }

async function probeMetricsClientId(): Promise<ProfileKeyProbe> {
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.METRICS_CLIENT_ID)
    if (typeof pref?.value === 'string' && isUuid(pref.value)) {
      return { status: 'resolved', value: pref.value }
    }
    return { status: 'unavailable' }
  } catch (err) {
    return err instanceof PrefApiUnavailableError
      ? { status: 'absent' }
      : { status: 'unavailable' }
  }
}

async function ensureLocalFallbackKey(): Promise<string> {
  const existing = await browserProfileKeyStorage.getValue()
  if (existing && isUuid(existing)) {
    return existing
  }
  const generated = crypto.randomUUID()
  await browserProfileKeyStorage.setValue(generated)
  return generated
}

async function resolveProfileKey(): Promise<string> {
  const probe = await probeMetricsClientId()
  if (probe.status === 'resolved') {
    cachedKey = probe.value
    return probe.value
  }

  const fallback = await ensureLocalFallbackKey()
  // 'absent' is permanent for this page (the API will never appear), so the
  // fallback is as final as a pref value would be — cache it like one.
  // 'unavailable' may still resolve on a later call (the brand-new-profile
  // race), so it stays uncached and every subsequent call re-probes — but
  // only within TRANSIENT_GRACE_MS of the first such probe, after which a
  // pref that's still not there is treated as never coming and cached too.
  if (probe.status === 'absent') {
    cachedKey = fallback
  } else {
    firstTransientProbeAt ??= Date.now()
    if (Date.now() - firstTransientProbeAt >= TRANSIENT_GRACE_MS) {
      cachedKey = fallback
    }
  }
  return fallback
}

/**
 * Returns a stable UUID identifying the current Chrome browser profile.
 *
 * The native metrics_client_id pref can be unset for a moment on a
 * brand-new profile — most likely to be hit by whichever extension page
 * happens to run first (onboarding, opened by the native first-run
 * handoff, typically runs before the side panel). If that first resolution
 * were cached as final, that page would be permanently stuck using a
 * locally-generated fallback id for the rest of the browser session, while
 * a page opened moments later (e.g. the side panel, once the pref is
 * populated) would resolve the real one — two different ids, two different
 * `profiles/<key>/` data directories, and edits made from one context
 * (soul_edit/user_edit, memory) silently never show up when read from the
 * other (Settings). Only a genuinely-transient resolution goes uncached, so
 * every context converges on the same key as soon as it's available, with
 * no reload needed — a *structurally* absent pref (dev / non-BrowserOS,
 * which can never change) still caches on the first call, same as before.
 *
 * Concurrent callers while a resolution is in flight (e.g. several
 * TanStack Query hooks firing on the same mount) share one probe instead
 * of each independently racing `ensureLocalFallbackKey`'s read-then-write.
 */
export async function getBrowserProfileKey(): Promise<string> {
  if (cachedKey) return cachedKey
  if (!inFlight) {
    inFlight = resolveProfileKey().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/** Test helper: clear the in-memory cache between cases. */
export function resetBrowserProfileKeyCacheForTests(): void {
  cachedKey = null
  inFlight = null
  firstTransientProbeAt = null
}
