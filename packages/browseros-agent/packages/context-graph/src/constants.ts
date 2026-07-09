/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const DEFAULT_BUCKET_ID = 'default'
export const DEFAULT_BUCKET_NAME = 'Default'
export const DEFAULT_BUCKET_KIND = 'general' as const

/** Cap stored node summaries (~2k chars). */
export const SUMMARY_MAX_CHARS = 2000

/** Cap FTS / search snippet text returned to callers. */
export const SNIPPET_MAX_CHARS = 500

/** Default / max hits for context_search. */
export const SEARCH_DEFAULT_LIMIT = 8
export const SEARCH_MAX_LIMIT = 15

/** Cap compact event payload JSON. */
export const EVENT_PAYLOAD_MAX_CHARS = 2000
