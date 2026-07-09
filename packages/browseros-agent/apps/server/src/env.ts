/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * Build-time inlined environment variables.
 *
 * IMPORTANT: Values here are replaced at build time by Bun's `--env inline` flag.
 * The `process.env.X` access MUST be direct (not via a variable) for inlining to work.
 *
 * These variables are:
 * - Replaced with literal strings in production builds
 * - Read from actual env vars during development
 *
 * For runtime-only env vars (like BROWSEROS_CDP_PORT), use process.env directly.
 */

const isPaneBuild = process.env.PANE_BUILD === 'true'

export const INLINED_ENV = {
  SENTRY_DSN: isPaneBuild ? undefined : process.env.SENTRY_DSN,
  POSTHOG_API_KEY: isPaneBuild ? undefined : process.env.POSTHOG_API_KEY,
  // Pane-operated config endpoint: forced unset in pane builds so the server
  // cannot reach api.pane.com / llm.browseros.com inadvertently.
  BROWSEROS_CONFIG_URL: isPaneBuild
    ? undefined
    : process.env.BROWSEROS_CONFIG_URL,
  // Remote Hermes JWT secret: not present in pane builds (agent runs locally).
  AGENT_RUNNER_JWT_SECRET: isPaneBuild
    ? undefined
    : process.env.AGENT_RUNNER_JWT_SECRET,
} as const

// In pane builds nothing is required at startup — telemetry is opt-in,
// and there is no Pane config URL. Development builds validate nothing
// to avoid friction. Only non-pane production builds enforce the list.
export const REQUIRED_FOR_PRODUCTION = isPaneBuild
  ? ([] as const)
  : (['SENTRY_DSN', 'POSTHOG_API_KEY', 'BROWSEROS_CONFIG_URL'] as const)
