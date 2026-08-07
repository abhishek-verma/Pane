/**
 * Pane product feature gates.
 *
 * Cloud features are disabled in Pane — local-first, no hosted services.
 * All flags are compile-time false so dead-code elimination removes every
 * gated branch from the bundle.
 *
 * @public
 */

export const productFeatures = {
  /** Hosted inference via api.pane.com gateway — not available in Pane. */
  hostedInference: false,
  /** Cloud account / GraphQL sync — not available in Pane. */
  cloudSync: false,
  /** Klavis managed app connectors — not available in Pane. */
  klavisIntegrations: false,
  /** Remote Hermes VM agent provider — not available in Pane. */
  remoteHermes: false,
  /** Usage & billing / credits UI — not available in Pane. */
  creditsBilling: false,
} as const

/** Sign-in and profile surfaces (only useful with cloud sync). */
export const cloudAccountEnabled = productFeatures.cloudSync
