/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Canonical PI addresses: pi://… ↔ #/pi/… HashRouter routes.
 */

export const PI_SCHEME = 'pi:'

export type PiHrefKind = 'site' | 'page' | 'entity' | 'temp' | 'library'

export type PiHrefParts =
  | { kind: 'library' }
  | { kind: 'site'; siteId: string }
  | { kind: 'page'; siteId: string; pageId: string }
  | { kind: 'entity'; siteId: string; entityKey: string }
  | { kind: 'temp'; tempId: string }

/** Hash route helpers (SPA). */
export function siteRoute(siteId: string): string {
  return `#/pi/sites/${siteId}`
}

export function pageRoute(siteId: string, pageId: string): string {
  return `#/pi/sites/${siteId}/pages/${pageId}`
}

export function entityRoute(siteId: string, entityKey: string): string {
  return `#/pi/sites/${siteId}/entities/${encodeURIComponent(entityKey)}`
}

export function tempRoute(tempId: string): string {
  return `#/pi/temp/${tempId}`
}

export function libraryRoute(): string {
  return '#/pi/library'
}

/** Canonical share / omnibox / bookmark URIs. */
export function siteHref(siteId: string): string {
  return `pi://sites/${siteId}`
}

export function pageHref(siteId: string, pageId: string): string {
  return `pi://sites/${siteId}/pages/${pageId}`
}

export function entityHref(siteId: string, entityKey: string): string {
  return `pi://sites/${siteId}/entities/${encodeURIComponent(entityKey)}`
}

export function tempHref(tempId: string): string {
  return `pi://temp/${tempId}`
}

export function libraryHref(): string {
  return 'pi://library'
}

export function routeToHref(route: string): string | null {
  const parts = parsePiRoute(route)
  if (!parts) return null
  return partsToHref(parts)
}

export function hrefToRoute(href: string): string | null {
  const parts = parsePiHref(href)
  if (!parts) return null
  return partsToRoute(parts)
}

export function partsToHref(parts: PiHrefParts): string {
  switch (parts.kind) {
    case 'library':
      return libraryHref()
    case 'site':
      return siteHref(parts.siteId)
    case 'page':
      return pageHref(parts.siteId, parts.pageId)
    case 'entity':
      return entityHref(parts.siteId, parts.entityKey)
    case 'temp':
      return tempHref(parts.tempId)
  }
}

export function partsToRoute(parts: PiHrefParts): string {
  switch (parts.kind) {
    case 'library':
      return libraryRoute()
    case 'site':
      return siteRoute(parts.siteId)
    case 'page':
      return pageRoute(parts.siteId, parts.pageId)
    case 'entity':
      return entityRoute(parts.siteId, parts.entityKey)
    case 'temp':
      return tempRoute(parts.tempId)
  }
}

/** Accepts `#/pi/…`, `/pi/…`, or `pi/…`. */
export function parsePiRoute(route: string): PiHrefParts | null {
  let s = route.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (!s.startsWith('/')) s = `/${s}`
  if (!s.startsWith('/pi/') && s !== '/pi') return null
  const path = s === '/pi' ? '' : s.slice('/pi/'.length)
  return parsePiPath(path)
}

/** Accepts `pi://…` (and trims whitespace). */
export function parsePiHref(href: string): PiHrefParts | null {
  const s = href.trim()
  if (!s.startsWith('pi://')) return null
  return parsePiPath(s.slice('pi://'.length))
}

function parsePiPath(path: string): PiHrefParts | null {
  if (!path || path === '/') return null
  const cleaned = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!cleaned) return null

  if (cleaned === 'library') return { kind: 'library' }

  const segments = cleaned.split('/')
  if (segments[0] === 'temp' && segments.length === 2 && segments[1]) {
    return { kind: 'temp', tempId: segments[1] }
  }

  if (segments[0] !== 'sites' || !segments[1]) return null
  const siteId = segments[1]

  if (segments.length === 2) return { kind: 'site', siteId }

  if (segments[2] === 'pages' && segments.length === 4 && segments[3]) {
    return { kind: 'page', siteId, pageId: segments[3] }
  }

  if (segments[2] === 'entities' && segments.length === 4 && segments[3]) {
    let entityKey = segments[3]
    try {
      entityKey = decodeURIComponent(entityKey)
    } catch {
      // keep raw
    }
    return { kind: 'entity', siteId, entityKey }
  }

  return null
}

/** Match pi://… tokens in prose (stops at whitespace / common markdown closers). */
export const PI_HREF_RE = /pi:\/\/[^\s)\]>'"`]+/g
