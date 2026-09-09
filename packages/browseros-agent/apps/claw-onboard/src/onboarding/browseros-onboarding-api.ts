/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const BROWSEROS_ONBOARDING_API_VERSION = 1 as const

export type BrowserOSImportItem =
  | 'history'
  | 'bookmarks'
  | 'cookies'
  | 'passwords'
  | 'searchEngines'
  | 'autofill'
  | 'extensions'

export type BrowserOSImportStatus =
  | 'idle'
  | 'detecting'
  | 'ready'
  | 'importing'
  | 'succeeded'
  | 'failed'
  | 'completed'

export const BrowserOSOnboardingMessage = {
  PAGE_READY: 'browserosOnboardingPageReady',
  REFRESH_SOURCES: 'browserosOnboardingRefreshSources',
  START_IMPORT: 'browserosOnboardingStartImport',
  COMPLETE: 'browserosOnboardingComplete',
} as const

export type BrowserOSOnboardingMessage =
  (typeof BrowserOSOnboardingMessage)[keyof typeof BrowserOSOnboardingMessage]

export interface BrowserOSImportSource {
  id: string
  displayName: string
  browserName: string
  profileName: string
  supportedItems: BrowserOSImportItem[]
  recommendedItems: BrowserOSImportItem[]
}

export interface BrowserOSImportProgress {
  currentItem?: BrowserOSImportItem
  completedItems: BrowserOSImportItem[]
  totalItems: number
}

export interface BrowserOSOnboardingError {
  code: string
  message: string
}

export interface BrowserOSOnboardingState {
  apiVersion: typeof BROWSEROS_ONBOARDING_API_VERSION
  status: BrowserOSImportStatus
  sources: BrowserOSImportSource[]
  progress?: BrowserOSImportProgress
  error?: BrowserOSOnboardingError
}

export interface BrowserOSStartImportRequest {
  sourceId: string
  items?: BrowserOSImportItem[]
}

interface BrowserOSOnboardingClient {
  receiveState(state: BrowserOSOnboardingState): void
}

export interface BrowserOSOnboardingChrome {
  send(message: BrowserOSOnboardingMessage, args?: unknown[]): void
}

declare global {
  interface Window {
    browserosOnboarding?: BrowserOSOnboardingClient
  }

  const chrome: BrowserOSOnboardingChrome
}
