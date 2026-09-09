import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { createMiddleware } from 'hono/factory'
import { tryGetProfileKey } from '../lib/profile-context'
import { layerAuthority, withLayerAccess } from './broker-auth'

/** General chat remains backwards compatible, but Layer mutations require a
 * native-authenticated request or an explicitly delegated author MCP session. */
export function optionalLayerAuthorization() {
  return createMiddleware(async (c, next) => {
    const authorization = c.req.header('Authorization')
    if (!authorization?.startsWith('Bearer pane.layers.auth.v1.')) return next()
    const access = layerAuthority?.verify(authorization)
    const profileId =
      tryGetProfileKey() ?? c.req.header(BROWSEROS_PROFILE_ID_HEADER)
    if (
      !access ||
      access.profileId !== profileId ||
      (access.role === 'author' &&
        c.req.header('X-BrowserOS-Scope-Id') !== access.scopeId)
    )
      return c.json(
        {
          error: 'Layer authorization expired or does not match this session.',
        },
        401,
      )
    return withLayerAccess(access, authorization, next)
  })
}
