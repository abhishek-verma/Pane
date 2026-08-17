/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Binds profile context for /mcp. Real MCP clients (Claude Code, Claude
 * Desktop, Codex, browseros-cli, ...) are configured with a single static
 * URL/command and most cannot set a custom header at all — so requiring
 * X-BrowserOS-Profile-Id here would just make every external MCP call 400,
 * and silently falling through with no profile bound splits their
 * reads/writes (SOUL.md, USER.md, memory, skills) from
 * `<install>/profiles/<key>/...`, which is what the extension (Settings
 * page, chat) always reads.
 *
 * Fix: the URL/snippet the Settings page hands out for external clients
 * (`apps/app/lib/browseros/helpers.ts#getMcpServerUrl`) embeds the profile
 * id as a query param, so a client that copy-pasted it is unambiguous by
 * construction — nothing to guess. The header still wins when both are
 * present (used by BrowserOS's own internal self-MCP connections, see
 * `buildBrowserOsSelfMcp.ts`). Only a request with neither — an old
 * pre-fix snippet, or a client typed the bare host:port by hand — falls
 * back to "the" profile when this install has exactly one; with zero or
 * multiple profiles there is nothing safe to guess, so those stay
 * profile-less (install root), same as before this fix existed.
 */

import {
  BROWSEROS_PROFILE_ID_HEADER,
  BROWSEROS_PROFILE_ID_QUERY_PARAM,
} from '@browseros/shared/constants/headers'
import { createMiddleware } from 'hono/factory'
import {
  ensureProfileDataDirs,
  listKnownProfileKeys,
} from '../../lib/browseros-dir'
import {
  isValidProfileKey,
  runWithProfileAsync,
} from '../../lib/profile-context'
import { claimLegacyProfileData } from '../../lib/profile-legacy-migrate'
import type { Env } from '../types'

async function resolveImplicitProfileKey(): Promise<string | null> {
  const known = await listKnownProfileKeys()
  return known.length === 1 ? (known[0] ?? null) : null
}

export function optionalProfile() {
  return createMiddleware<Env>(async (c, next) => {
    const header = c.req.header(BROWSEROS_PROFILE_ID_HEADER)?.trim() ?? ''
    const query = c.req.query(BROWSEROS_PROFILE_ID_QUERY_PARAM)?.trim() ?? ''
    const explicit = [header, query].find((v) => v && isValidProfileKey(v))
    const raw = explicit ?? (await resolveImplicitProfileKey())

    if (!raw) {
      await next()
      return
    }

    return runWithProfileAsync(raw, async () => {
      claimLegacyProfileData(raw)
      await ensureProfileDataDirs()
      await next()
    })
  })
}
