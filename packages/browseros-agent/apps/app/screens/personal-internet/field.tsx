/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Living Grid chromatic fields (spec 21).
 *
 * The shell (home, side panel, settings) is achromatic. A Personalised
 * Internet "place" carries a field: a full-bleed background hue that makes
 * navigating into it a visible event and keeps two places from feeling like
 * the same page.
 */

import type { FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Order is load-bearing: a field is assigned by hashing modulo this length,
 * so reordering reassigns every existing place. Append only.
 */
export const PI_FIELDS = [
  'rust',
  'ember',
  'amber',
  'clay',
  'moss',
  'petrol',
  'dust',
  'iris',
  'plum',
  'slate',
] as const

export type PiField = (typeof PI_FIELDS)[number]

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic, so a place looks the same on every visit and every device. */
export function piFieldFor(seed: string): PiField {
  return PI_FIELDS[fnv1a(seed) % PI_FIELDS.length]
}

export function piSiteField(siteId: string | undefined): PiField {
  return piFieldFor(siteId ?? 'unknown')
}

/**
 * Entity pages get their own field rather than inheriting the site's, so a
 * company reads as its own site. The site id stays in the seed so the same
 * entity key under two different sites still diverges.
 */
export function piEntityField(
  siteId: string | undefined,
  entityKey: string | undefined,
): PiField {
  return piFieldFor(`${siteId ?? 'unknown'}:${entityKey ?? 'unknown'}`)
}

/**
 * Applies a field's tokens to its subtree. Every descendant utility
 * (bg-card, bg-muted, border-border, text-muted-foreground) resolves against
 * the field automatically, so page components stay field-agnostic.
 */
export const PiFieldSurface: FC<{
  field: PiField
  className?: string
  children: ReactNode
}> = ({ field, className, children }) => (
  <div
    data-field={field}
    className={cn('flex min-h-screen flex-col', className)}
  >
    {children}
  </div>
)
