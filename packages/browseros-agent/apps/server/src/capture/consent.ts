/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { isMeetingConsentAllowed } from '@browseros/capture/adapters'
import type { CaptureClass } from '@browseros/capture/types'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { ensureDefaultBucket } from '@browseros/context-graph/repo'
import { getDbHandle } from '../lib/db'

export interface CaptureConsent {
  domain: string
  class: CaptureClass
  bucketId: string
  allowed: boolean
  updatedAt: number
}

const PROTECTED_DOMAIN_RE =
  /(^|\.)((bank|paypal|stripe|health|medical|gov|irs|tax|insurance)\.|.*\.gov$)/i

function sqlite() {
  return getDbHandle().sqlite
}

export function normalizeCaptureDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return (
      value
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0] || value
    )
  }
}

export function isProtectedCaptureDomain(domain: string): boolean {
  return PROTECTED_DOMAIN_RE.test(domain.toLowerCase())
}

export function listCaptureConsents(bucketId?: string): CaptureConsent[] {
  ensureDefaultBucket(sqlite() as never)
  const sql = `SELECT domain, class, bucket_id, allowed, updated_at
    FROM capture_consents ${bucketId ? 'WHERE bucket_id = ?' : ''}
    ORDER BY domain, class`
  const rows = bucketId
    ? sqlite()
        .prepare<
          {
            domain: string
            class: CaptureClass
            bucket_id: string
            allowed: number
            updated_at: number
          },
          [string]
        >(sql)
        .all(bucketId)
    : sqlite()
        .prepare<
          {
            domain: string
            class: CaptureClass
            bucket_id: string
            allowed: number
            updated_at: number
          },
          []
        >(sql)
        .all()
  return rows.map((row) => ({
    domain: row.domain,
    class: row.class,
    bucketId: row.bucket_id,
    allowed: row.allowed !== 0,
    updatedAt: row.updated_at,
  }))
}

export function setCaptureConsent(input: {
  domain: string
  class: CaptureClass
  allowed: boolean
  bucketId?: string
}): CaptureConsent {
  ensureDefaultBucket(sqlite() as never)
  const domain = normalizeCaptureDomain(input.domain)
  const allowed = input.allowed && !isProtectedCaptureDomain(domain)
  const bucketId = input.bucketId ?? DEFAULT_BUCKET_ID
  const updatedAt = Date.now()
  sqlite()
    .prepare(
      `INSERT INTO capture_consents (domain, class, bucket_id, allowed, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(domain, class)
       DO UPDATE SET bucket_id = excluded.bucket_id,
         allowed = excluded.allowed,
         updated_at = excluded.updated_at`,
    )
    .run(domain, input.class, bucketId, allowed ? 1 : 0, updatedAt)
  return { domain, class: input.class, bucketId, allowed, updatedAt }
}

export function getCaptureConsent(
  domainOrUrl: string,
  captureClass: CaptureClass,
): CaptureConsent | null {
  const domain = normalizeCaptureDomain(domainOrUrl)
  const row = sqlite()
    .prepare<
      {
        domain: string
        class: CaptureClass
        bucket_id: string
        allowed: number
        updated_at: number
      },
      [string, CaptureClass]
    >(
      `SELECT domain, class, bucket_id, allowed, updated_at
       FROM capture_consents WHERE domain = ? AND class = ?`,
    )
    .get(domain, captureClass)
  if (!row) return null
  return {
    domain: row.domain,
    class: row.class,
    bucketId: row.bucket_id,
    allowed: row.allowed !== 0,
    updatedAt: row.updated_at,
  }
}

export function requireCaptureConsent(
  domainOrUrl: string,
  captureClass: CaptureClass,
): CaptureConsent {
  const consent = getCaptureConsent(domainOrUrl, captureClass)
  if (consent?.allowed) return consent

  if (captureClass === 'meeting') {
    const host = normalizeCaptureDomain(domainOrUrl)
    const meetingConsents = listCaptureConsents().filter(
      (c) => c.class === 'meeting' && c.allowed,
    )
    const allowedDomains = meetingConsents.map((c) => c.domain)
    if (isMeetingConsentAllowed(host, allowedDomains)) {
      const matched =
        meetingConsents.find((c) =>
          isMeetingConsentAllowed(host, [c.domain]),
        ) ?? meetingConsents[0]
      if (matched) return matched
    }
  }

  throw new Error(`Capture is off for ${captureClass} on this domain`)
}
