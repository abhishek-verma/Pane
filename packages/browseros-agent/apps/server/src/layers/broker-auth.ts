import { AsyncLocalStorage } from 'node:async_hooks'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, fstatSync, readSync } from 'node:fs'
import { z } from 'zod'

export const LAYER_EXTENSION_ID = 'biedncddmddkpapdplhcnkhhplnfgbif'
const PREFIX = 'pane.layers.auth.v1.'
export const LAYER_AUTHOR_SESSION_PREFIX = 'Bearer pane.layers.session.v1.'
const claimsSchema = z
  .object({
    profileId: z.string().uuid(),
    expiresAt: z.number().int().positive(),
    extensionId: z.literal(LAYER_EXTENSION_ID).optional(),
    role: z.literal('author').optional(),
    scopeId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) =>
    v.role === 'author'
      ? Boolean(v.scopeId) && !v.extensionId
      : v.extensionId === LAYER_EXTENSION_ID && !v.scopeId,
  )
export type LayerAccess = z.infer<typeof claimsSchema>
const context = new AsyncLocalStorage<{
  access: LayerAccess
  authorization: string
}>()

export class LayerAuthority {
  private readonly authorSessions = new Map<
    string,
    { profileId: string; scopeId: string }
  >()

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[a-fA-F0-9]{64}$/.test(secret))
      throw new Error('Invalid Layers launch secret.')
  }

  verify(authorization: string | undefined): LayerAccess | null {
    if (
      !authorization?.startsWith(`Bearer ${PREFIX}`) ||
      authorization.length > 2048
    )
      return null
    const token = authorization.slice(7)
    const separator = token.lastIndexOf('.')
    const message = token.slice(0, separator)
    const signature = token.slice(separator + 1)
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return null
    const expected = createHmac('sha256', this.secret).update(message).digest()
    const received = Buffer.from(signature, 'base64url')
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return null
    try {
      const claims = claimsSchema.parse(
        JSON.parse(
          Buffer.from(message.slice(PREFIX.length), 'base64url').toString(
            'utf8',
          ),
        ),
      )
      const remaining = claims.expiresAt - this.now()
      if (
        remaining <= 0 ||
        remaining >
          (claims.role === 'author' ? 30 * 60_000 : 5 * 60_000) + 30_000
      )
        return null
      return claims
    } catch {
      return null
    }
  }

  delegateAuthor(access: LayerAccess, scopeId: string): string {
    if (access.role || access.expiresAt <= this.now())
      throw new Error('A current browser credential is required.')
    const claims = claimsSchema.parse({
      profileId: access.profileId,
      role: 'author',
      scopeId,
      expiresAt: this.now() + 30 * 60_000,
    })
    const message =
      PREFIX + Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `Bearer ${message}.${createHmac('sha256', this.secret).update(message).digest('base64url')}`
  }

  /** Exchange a current delegation for a capability owned by one live ACP
   * provider. MCP headers are immutable for that provider's lifetime, which
   * may span many turns. Unlike browser credentials this capability works only
   * on /mcp, cannot mint other credentials, and is revoked on provider close.
   * Nothing is restored from disk: a server restart invalidates every session.
   */
  openAuthorSession(
    authorization: string,
    profileId: string,
    scopeId: string,
  ): { authorization: string; close: () => void } {
    const access = this.verify(authorization)
    if (
      access?.role !== 'author' ||
      access.profileId !== profileId ||
      access.scopeId !== scopeId
    )
      throw new Error(
        'A current, matching Layer author delegation is required.',
      )
    const token = LAYER_AUTHOR_SESSION_PREFIX + randomBytes(32).toString('hex')
    this.authorSessions.set(token, { profileId, scopeId })
    return {
      authorization: token,
      close: () => {
        this.authorSessions.delete(token)
      },
    }
  }

  verifyAuthorSession(authorization: string): LayerAccess | null {
    const session = this.authorSessions.get(authorization)
    return session
      ? { ...session, role: 'author', expiresAt: this.now() + 30 * 60_000 }
      : null
  }
}

/** Consumed before any provider subprocess launches. No file/URL/CLI secret
 * fallback exists. The descriptor number itself is not confidential. */
function inheritedAuthority(): LayerAuthority | null {
  const raw = process.env.PANE_LAYERS_BOOTSTRAP_FD
  delete process.env.PANE_LAYERS_BOOTSTRAP_FD
  if (!raw) return null
  if (raw !== '3') throw new Error('Invalid Layers bootstrap descriptor.')
  const fd = 3
  try {
    if (!fstatSync(fd).isFIFO())
      throw new Error('Layers bootstrap must use an inherited pipe.')
    const bytes = Buffer.alloc(65)
    let count = 0
    while (count < bytes.length) {
      const length = readSync(fd, bytes, count, bytes.length - count, null)
      if (!length) break
      count += length
    }
    if (count !== 64) throw new Error('Invalid Layers bootstrap payload.')
    return new LayerAuthority(bytes.subarray(0, count).toString('ascii'))
  } finally {
    closeSync(fd)
  }
}

export const layerAuthority = inheritedAuthority()
export function withLayerAccess<T>(
  access: LayerAccess,
  authorization: string,
  work: () => T,
): T {
  return context.run({ access, authorization }, work)
}
export function getLayerAccess(): LayerAccess | null {
  return context.getStore()?.access ?? null
}
export function getLayerAuthorAuthorization(
  scopeId: string,
): string | undefined {
  const value = context.getStore()
  if (!value || !layerAuthority) return undefined
  if (value.access.role === 'author')
    return value.access.scopeId === scopeId ? value.authorization : undefined
  return layerAuthority.delegateAuthor(value.access, scopeId)
}
