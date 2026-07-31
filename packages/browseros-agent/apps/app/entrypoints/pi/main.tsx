/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Dedicated PI document. Not the NTP override — Chromium must not rewrite
 * this to chrome://newtab. Canonical internal URL is pi.html#/pi/….
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles/global.css'
import { ThemeProvider } from '@/components/theme-provider.tsx'
import { Toaster } from '@/components/ui/sonner'
import { AnalyticsProvider } from '@/lib/analytics/AnalyticsProvider.tsx'
import { initPostHog } from '@/lib/analytics/posthog'
import { QueryProvider } from '@/lib/graphql/QueryProvider'
import { defaultPiDocumentHash } from '@/lib/personal-internet/pi-document'
import { initSentry } from '@/lib/sentry/sentry'
import { sentryRootErrorHandler } from '@/lib/sentry/sentryRootErrorHandler.ts'
import { App } from '../app/App'

// A bare pi.html means Library. Explicit non-PI routes are preserved so the
// document guard can transfer them to app.html instead of swallowing them.
const defaultHash = defaultPiDocumentHash(window.location.hash)
if (defaultHash) {
  window.location.hash = defaultHash
}

initPostHog().catch(() => {})
initSentry().catch(() => {})

const $root = document.getElementById('root')

if ($root) {
  ReactDOM.createRoot($root, sentryRootErrorHandler).render(
    <React.StrictMode>
      <QueryProvider>
        <AnalyticsProvider>
          <ThemeProvider>
            <App />
            <Toaster />
          </ThemeProvider>
        </AnalyticsProvider>
      </QueryProvider>
    </React.StrictMode>,
  )
}
