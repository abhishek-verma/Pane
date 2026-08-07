import posthog from 'posthog-js'
import { env } from '../env'

import { telemetryStorage } from './telemetryStorage'

export const initPostHog = async () => {
  const isOptedIn = await telemetryStorage.getValue()
  if (
    isOptedIn &&
    env.VITE_PUBLIC_POSTHOG_KEY &&
    env.VITE_PUBLIC_POSTHOG_HOST
  ) {
    posthog.init(env.VITE_PUBLIC_POSTHOG_KEY, {
      api_host: env.VITE_PUBLIC_POSTHOG_HOST,
      person_profiles: 'identified_only',
      disable_external_dependency_loading: true,
      // DOM session recording is banned in the privileged extension renderer:
      // the recorder package must never be imported here, and init must not
      // enable recording even if a future posthog-js default flips.
      disable_session_recording: true,
      capture_pageview: true,
      autocapture: true,
      persistence: 'localStorage',
      loaded: (posthog) => {
        posthog.register({
          extension_version: chrome.runtime.getManifest().version,
          ui_context: window.location.pathname,
        })
      },
    })
  }
}

export { posthog }
