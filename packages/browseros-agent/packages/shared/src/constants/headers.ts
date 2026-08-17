/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Shared HTTP header names for the agent server and extension.
 */

/** Chrome browser profile key for per-profile server data isolation. */
export const BROWSEROS_PROFILE_ID_HEADER = 'X-BrowserOS-Profile-Id'

/**
 * Query-param form of the profile key, for MCP client configs that only
 * support a static URL (Claude Code, Claude Desktop, Codex, ...) and cannot
 * set a custom header. The Settings page embeds this in the URL it hands
 * out so every generated connection snippet is unambiguous by construction
 * — see `apps/app/lib/browseros/helpers.ts#getMcpServerUrl` and
 * `apps/server/src/api/middleware/optional-profile.ts`.
 */
export const BROWSEROS_PROFILE_ID_QUERY_PARAM = 'browserosProfileId'
