/**
 * Pane product feature gates.
 *
 * Features that need BrowserOS cloud credentials stay off by default.
 * Opt in via `.env` when you have the keys and URLs configured.
 *
 * @public
 */
function envFlag(name: string, defaultValue = false): boolean {
  const value = import.meta.env[name]
  if (value === undefined || value === '') return defaultValue
  return value === 'true'
}

export const productFeatures = {
  /** Built-in Pane/BrowserOS hosted inference (api.browseros.com gateway + credits). */
  hostedInference: envFlag('VITE_HOSTED_INFERENCE', false),
  /** Cloud account: GraphQL sync for providers, conversations, schedules, profile. */
  cloudSync: envFlag('VITE_CLOUD_SYNC', false),
  /** Klavis managed app connectors (Gmail, Slack, …) via BrowserOS proxy. */
  klavisIntegrations: envFlag('VITE_KLAVIS_INTEGRATIONS', false),
  /** Remote Hermes VM agent provider. */
  remoteHermes: envFlag('VITE_REMOTE_HERMES', false),
  /** Usage & billing / credits UI. */
  creditsBilling: envFlag('VITE_CREDITS_BILLING', false),
} as const

/** Sign-in and profile surfaces (only useful with cloud sync). */
export const cloudAccountEnabled = productFeatures.cloudSync
