import { storage } from '@wxt-dev/storage'

/**
 * @public
 */
export const telemetryStorage = storage.defineItem<boolean>(
  'local:telemetryEnabled',
  {
    fallback: false, // Default off in Pane
  },
)
