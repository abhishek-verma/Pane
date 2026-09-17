import { afterEach, describe, expect, it, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { Hono } from 'hono'
import {
  getLayerAccess,
  LAYER_EXTENSION_ID,
  LayerAuthority,
} from '../../src/layers/broker-auth'

let now = Date.now()
const authority = new LayerAuthority('ab'.repeat(32), () => now)
const profileId = randomUUID()
const scopeId = randomUUID()
const delegation = () =>
  authority.delegateAuthor(
    {
      profileId,
      extensionId: LAYER_EXTENSION_ID,
      expiresAt: now + 300_000,
    },
    scopeId,
  )
let settings: any
let failCreate = false
let failClose = false
mock.module('../../src/layers/broker-auth', () => ({
  // Preserve the actual ALS exports used by the middleware.
  ...require('../../src/layers/broker-auth'),
  layerAuthority: authority,
}))
mock.module('acpx-ai-provider', () => ({
  createAcpxProvider: (value: any) => {
    settings = value
    if (failCreate) throw new Error('create failed')
    return {
      close: async () => {
        if (failClose) throw new Error('close failed')
      },
    }
  },
}))
const { optionalLayerAuthorization } = await import(
  '../../src/layers/auth-middleware'
)
const { buildAcpxProvider } = await import(
  '../../src/lib/agents/acpx-provider/buildAcpxProvider'
)
const app = new Hono()
  .use('*', optionalLayerAuthorization(authority))
  .all('*', (c) => c.json({ access: getLayerAccess() }))
const entry = (authorization = delegation()) => ({
  type: 'http' as const,
  name: 'browseros',
  url: 'http://127.0.0.1:9100/mcp',
  headers: [
    { name: 'Authorization', value: authorization },
    { name: BROWSEROS_PROFILE_ID_HEADER, value: profileId },
    { name: 'X-BrowserOS-Scope-Id', value: scopeId },
  ],
})
const request = (
  token: string,
  profile = profileId,
  scope = scopeId,
  path = '/mcp',
) =>
  app.request(path, {
    headers: {
      Authorization: token,
      [BROWSEROS_PROFILE_ID_HEADER]: profile,
      'X-BrowserOS-Scope-Id': scope,
    },
  })
afterEach(() => {
  failCreate = false
  failClose = false
})

describe('ACP Layer author lifetime', () => {
  for (const agentId of ['claude', 'codex']) {
    it(`${agentId} keeps the same MCP credential across expiry and revokes it on disposal`, async () => {
      const original = entry()
      const provider = await buildAcpxProvider({
        conversationId: scopeId,
        agentId,
        mcpServers: [original],
      })
      const token = settings.mcpServers[0].headers.Authorization
      expect(token).not.toBe(original.headers[0].value)
      expect((await request(token)).status).toBe(200)
      now += 31 * 60_000
      expect(authority.verify(original.headers[0].value)).toBeNull()
      const response = await request(token)
      expect(response.status).toBe(200)
      expect((await response.json()).access).toMatchObject({
        profileId,
        scopeId,
        role: 'author',
        expiresAt: now + 30 * 60_000,
      })
      expect((await request(token, randomUUID())).status).toBe(401)
      expect((await request(token, profileId, randomUUID())).status).toBe(401)
      expect((await request(token, profileId, scopeId, '/chat')).status).toBe(
        401,
      )
      expect(authority.verify(token)).toBeNull() // No native broker authority.
      expect(
        new LayerAuthority('ab'.repeat(32)).verifyAuthorSession(token),
      ).toBeNull()
      await provider.close()
      expect((await request(token)).status).toBe(401)
      const replacement = await buildAcpxProvider({
        conversationId: scopeId,
        agentId,
        mcpServers: [entry()],
      })
      const next = settings.mcpServers[0].headers.Authorization
      expect(next).not.toBe(token)
      expect((await request(next)).status).toBe(200)
      expect((await request(token)).status).toBe(401)
      await replacement.close()
    })
  }
  it('revokes even when close or construction fails', async () => {
    const provider = await buildAcpxProvider({
      conversationId: scopeId,
      agentId: 'claude',
      mcpServers: [entry()],
    })
    const token = settings.mcpServers[0].headers.Authorization
    failClose = true
    await expect(provider.close()).rejects.toThrow('close failed')
    expect(authority.verifyAuthorSession(token)).toBeNull()
    failCreate = true
    await expect(
      buildAcpxProvider({
        conversationId: scopeId,
        agentId: 'claude',
        mcpServers: [entry()],
      }),
    ).rejects.toThrow('create failed')
    expect(
      authority.verifyAuthorSession(
        settings.mcpServers[0].headers.Authorization,
      ),
    ).toBeNull()
  })
  it('does not exchange a remote connector or grant cross-profile/session authority', async () => {
    const remote = { ...entry(), url: 'https://example.com/mcp' }
    await buildAcpxProvider({
      conversationId: scopeId,
      agentId: 'claude',
      mcpServers: [remote],
    })
    expect(settings.mcpServers[0].headers.Authorization).toBe(
      remote.headers[0].value,
    )
    expect(() =>
      authority.openAuthorSession(delegation(), randomUUID(), scopeId),
    ).toThrow('matching')
    expect(() =>
      authority.openAuthorSession(delegation(), profileId, randomUUID()),
    ).toThrow('matching')
    const session = authority.openAuthorSession(
      delegation(),
      profileId,
      scopeId,
    )
    expect(() =>
      authority.openAuthorSession(session.authorization, profileId, scopeId),
    ).toThrow('matching')
    session.close()
  })
})
