/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Centralized timeout configuration.
 */

export const KLAVIS_PROXY_RETRY_BACKOFF_MS = [
  5_000, 10_000, 20_000, 40_000, 60_000,
] as const

export const TIMEOUTS = {
  // Agent/Tool execution
  TOOL_CALL: 120_000,
  TOOL_POST_ACTION: 2_000,
  TEST_PROVIDER: 15_000,
  REFINE_PROMPT: 30_000,

  // MCP operations
  MCP_DEFAULT: 5_000,
  MCP_TRANSPORT_PROBE: 5_000,
  MCP_CLIENT_CONNECT: 15_000,

  // CDP connection
  CDP_CONNECT: 10_000,
  CDP_CONNECT_RETRY_DELAY: 1_000,
  CDP_RECONNECT_DELAY: 5_000,
  CDP_KEEPALIVE_INTERVAL: 30_000,
  CDP_KEEPALIVE_TIMEOUT: 10_000,
  CDP_REQUEST_TIMEOUT: 60_000,

  // External API calls
  KLAVIS_FETCH: 30_000,
  /** Fetch a remote SKILL.md for skills_install. */
  SKILL_FETCH: 15_000,

  // Navigation/DOM
  NAVIGATION: 10_000,
  PAGE_LOAD_WAIT: 30_000,
  PAGE_LOAD_POLL_INTERVAL: 150,
  STABLE_DOM: 3_000,
  FILE_CHOOSER: 3_000,
  DOWNLOAD: 60_000,

  // OAuth
  OAUTH_FLOW_TTL: 300_000,
  OAUTH_TOKEN_EXPIRY_BUFFER: 300_000,
  OAUTH_POLL_INTERVAL: 2_000,
  OAUTH_POLL_TIMEOUT: 300_000,
  DEVICE_CODE_POLL_SAFETY_MARGIN: 3_000,

  /**
   * `useChat({ experimental_throttle })` — coalesces streamed-token state
   * updates so the chat message tree (markdown parse, syntax highlight,
   * diagram dispatch) re-renders on a fixed cadence instead of once per SSE
   * token. Without this, a response with heavy content (large code blocks,
   * several diagrams) re-runs the full render pipeline hundreds of times
   * during a single stream.
   */
  CHAT_STREAM_RENDER_THROTTLE: 66,

  // Server session store — idle in-memory session eviction. Transcripts are
  // already durable in SQLite; this only bounds how long a live AiSdkAgent
  // (MCP clients, model connection) stays resident in the server process
  // for a conversation nobody is actively using. See session-store.ts.
  SESSION_IDLE_EVICT: 30 * 60_000,
  SESSION_SWEEP_INTERVAL: 5 * 60_000,
} as const

export type TimeoutKey = keyof typeof TIMEOUTS
