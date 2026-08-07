/**
 * @license
 * Copyright 2025 Pane
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

export const INLINED_ENV = {
  // Telemetry is opt-in; keys are only required in non-Pane production deployments.
  SENTRY_DSN: process.env.SENTRY_DSN,
  POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
  // Remote Hermes JWT secret: only needed when running a remote agent runner.
  AGENT_RUNNER_JWT_SECRET: process.env.AGENT_RUNNER_JWT_SECRET,
} as const

// Nothing is required at startup — telemetry is opt-in, agent runs locally.
export const REQUIRED_FOR_PRODUCTION = [] as const
