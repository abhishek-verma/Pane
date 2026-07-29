/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import { getBrowserosDir } from '../lib/browseros-dir'

export function piRoot(browserosDir?: string): string {
  return join(browserosDir ?? getBrowserosDir(), 'personal-internet')
}

export function siteDir(siteId: string, browserosDir?: string): string {
  return join(piRoot(browserosDir), 'sites', siteId)
}

export function pageFile(
  siteId: string,
  pageId: string,
  browserosDir?: string,
): string {
  return join(siteDir(siteId, browserosDir), 'pages', `${pageId}.json`)
}

export function siteManifestFile(
  siteId: string,
  browserosDir?: string,
): string {
  return join(siteDir(siteId, browserosDir), 'SITE.md')
}

export function tempFile(tempId: string, browserosDir?: string): string {
  return join(piRoot(browserosDir), 'temps', `${tempId}.json`)
}

export function homeRegionsFile(browserosDir?: string): string {
  return join(piRoot(browserosDir), 'home', 'HOME.json')
}

export function homePrefsFile(browserosDir?: string): string {
  return join(piRoot(browserosDir), 'home', 'prefs.json')
}

export function siteRoute(siteId: string): string {
  return `#/pi/sites/${siteId}`
}

export function pageRoute(siteId: string, pageId: string): string {
  return `#/pi/sites/${siteId}/pages/${pageId}`
}

export function tempRoute(tempId: string): string {
  return `#/pi/temp/${tempId}`
}
