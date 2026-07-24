/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Requires X-BrowserOS-Profile-Id and binds profile context for the request.
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

/**
 * Middleware: validate profile header, claim legacy data once, bind ALS
 * for the rest of the request so getDb()/path helpers resolve per profile.
 */
export function requireProfile() {
  return createMiddleware<Env>(async (c, next) => {
    const raw = c.req.header(BROWSEROS_PROFILE_ID_HEADER)?.trim() ?? ''
    if (!raw || !isValidProfileKey(raw)) {
      return c.json(
        {
          error: `Missing or invalid ${BROWSEROS_PROFILE_ID_HEADER} header`,
        },
        400,
      )
    }

    return runWithProfileAsync(raw, async () => {
      claimLegacyProfileData(raw)
      await ensureProfileDataDirs()
      await next()
    })
  })
}
