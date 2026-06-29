/**
 * Pane product feature gates.
 *
 * In `pane` builds (`PANE_BUILD=true`) all five cloud flags are compile-time
 * `false` so dead-code elimination removes every gated branch; a stray env var
 * cannot silently re-introduce a Pane-server surface at runtime.
 *
 * In other builds, flags are read from env (all default false).
 *
 * @public
 */

/**
 * True in `pane` builds — inlined by Vite/WXT so tree-shaking eliminates
 * all `if (!PANE_BUILD)` branches from the bundle.
 * @public
 */
export const PANE_BUILD: boolean = import.meta.env.PANE_BUILD === 'true'

function envFlag(name: string, defaultValue = false): boolean {
  // In pane builds all cloud flags are permanently off; skip env lookup.
  if (PANE_BUILD) return false
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
