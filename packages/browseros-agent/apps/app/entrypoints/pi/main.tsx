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
import { initSentry } from '@/lib/sentry/sentry'
import { sentryRootErrorHandler } from '@/lib/sentry/sentryRootErrorHandler.ts'
import { App } from '../app/App'

// Non-PI hashes on this document are not valid — land on the library.
const hash = window.location.hash
if (!hash.startsWith('#/pi/') && hash !== '#/pi') {
  window.location.hash = '/pi/library'
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
