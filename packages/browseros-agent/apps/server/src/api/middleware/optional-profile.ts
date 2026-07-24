/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Binds profile context when X-BrowserOS-Profile-Id is present; otherwise
 * continues without a profile (for external MCP clients).
 */

import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { createMiddleware } from 'hono/factory'
import { ensureProfileDataDirs } from '../../lib/browseros-dir'
import {
  isValidProfileKey,
  runWithProfileAsync,
} from '../../lib/profile-context'
import { claimLegacyProfileData } from '../../lib/profile-legacy-migrate'
import type { Env } from '../types'

export function optionalProfile() {
  return createMiddleware<Env>(async (c, next) => {
    const raw = c.req.header(BROWSEROS_PROFILE_ID_HEADER)?.trim() ?? ''
    if (!raw || !isValidProfileKey(raw)) {
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
