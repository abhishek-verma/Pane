import * as Sentry from '@sentry/react'
import { getBrowserOSAdapter } from '../browseros/adapter'
import { env } from '../env'
import { sanitizeEvent } from './sanitize'

/** Errors that are expected during normal operation and should not be reported */
const SUPPRESSED_ERRORS = ['The browser is shutting down', 'No current window']

function getExtensionPage(): string {
  try {
    const url = new URL(location.href)
    // Extract the entry point name from the extension URL pathname
    // e.g. chrome-extension://<id>/sidepanel.html -> sidepanel
    return url.pathname.replace(/^\//, '').replace(/\.html$/, '') || 'unknown'
  } catch {
    return 'unknown'
  }
}

import { telemetryStorage } from '../analytics/telemetryStorage'

/**
 * The MV3 background service worker is a separate JS realm with no `window`/
 * `document` — each realm needs its own `Sentry.init()` call, and the DOM
 * breadcrumbs integration doesn't apply there. Without this, `sentry.*` calls
 * made from background-invoked code (e.g. lib/schedules/syncSchedulesToBackend.ts)
 * are silent no-ops: Sentry was never initialized in that realm.
 */
export const initSentry = async (options?: {
  enableDomBreadcrumbs?: boolean
}) => {
  const isOptedIn = await telemetryStorage.getValue()
  const enableDomBreadcrumbs = options?.enableDomBreadcrumbs ?? true

  if (isOptedIn && env.VITE_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: env.VITE_PUBLIC_SENTRY_DSN,
      // Setting this option to true will send default PII data to Sentry.
      // For example, automatic IP address collection on events
      sendDefaultPii: true,
      environment: env.PROD ? 'production' : 'development',
      release: chrome.runtime.getManifest().version,

      beforeSend(event) {
        const message = event.exception?.values?.[0]?.value ?? ''
        if (SUPPRESSED_ERRORS.some((s) => message.includes(s))) {
          return null
        }

        event.tags = {
          ...event.tags,
          extensionPage: getExtensionPage(),
        }

        return sanitizeEvent(event)
      },

      integrations: [
        Sentry.breadcrumbsIntegration({
          console: true,
          dom: enableDomBreadcrumbs,
          fetch: true,
          xhr: true,
        }),
      ],
    })

    const adapter = getBrowserOSAdapter()
    const chromiumVersion = await adapter.getVersion()
    const browserOSVersion = await adapter.getBrowserosVersion()
    Sentry.setTag('chromiumVersion', chromiumVersion)
    Sentry.setTag('browserOSVersion', browserOSVersion)
  }
}

/**
 * @public
 */
export const sentry = Sentry
