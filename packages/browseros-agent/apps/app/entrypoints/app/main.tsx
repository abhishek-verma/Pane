import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles/global.css'
import { ThemeProvider } from '@/components/theme-provider.tsx'
import { Toaster } from '@/components/ui/sonner'
import { AnalyticsProvider } from '@/lib/analytics/AnalyticsProvider.tsx'
import { initPostHog } from '@/lib/analytics/posthog'
import { QueryProvider } from '@/lib/graphql/QueryProvider'
import { migrateLegacyPiDocumentIfNeeded } from '@/lib/personal-internet/migrate-legacy-pi-document'
import { initSentry } from '@/lib/sentry/sentry'
import { sentryRootErrorHandler } from '@/lib/sentry/sentryRootErrorHandler.ts'
import { App } from './App'

// PI must not live on the NTP override document. Migrate before React mounts.
if (migrateLegacyPiDocumentIfNeeded()) {
  // Navigation started — do not mount the home shell on this document.
} else {
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
}
