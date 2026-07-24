/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { Hono } from 'hono'
import type { Env } from '../../../src/api/types'
import { TurnRegistry } from '../../../src/lib/agents/turns/active-turn-registry'
import { closeDb, initializeDb } from '../../../src/lib/db'
import { resetLegacyClaimForTests } from '../../../src/lib/profile-legacy-migrate'

mock.module('../../../src/lib/mcp-manager', () => ({
  humaniseInstallError: (err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
    status: 500,
  }),
  installInto: mock(async () => ({ success: true })),
  listAgents: mock(async () => []),
  uninstallFrom: mock(async () => ({ success: true })),
}))

const { createApiRoutes } = await import('../../../src/api/routes')

const PROFILE = '44444444-4444-4444-8444-444444444444'

function profileHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    [BROWSEROS_PROFILE_ID_HEADER]: PROFILE,
    ...extra,
  }
}

function createTestConfig() {
  return {
    port: 32123,
    version: '0.0.0-test',
    browser: {
      isCdpConnected: () => false,
    },
    browserSession: {},
    executionDir: '/tmp/browseros-test',
    resourcesDir: '/tmp/browseros-resources',
    aiSdkDevtoolsEnabled: false,
  } as never
}

function createTestApp(agentRoutes = new Hono<Env>()) {
  return createApiRoutes({
    agentRoutes,
    config: createTestConfig(),
    tokenManager: null,
    turnRegistry: new TurnRegistry(),
    onShutdown: () => {},
  })
}

describe('createApiRoutes', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-routes-index-'))
    process.env.BROWSEROS_DIR = dir
    resetLegacyClaimForTests()
    closeDb()
    initializeDb({})
  })

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    resetLegacyClaimForTests()
  })

  it('mounts the health route', async () => {
    const response = await createTestApp().request('/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      cdpConnected: false,
    })
  })

  it('preserves the OAuth unavailable fallback', async () => {
    const response = await createTestApp().request('/oauth/openai/status', {
      headers: profileHeaders(),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'OAuth not available',
    })
  })

  it('mounts the MCP manager routes', async () => {
    const response = await createTestApp().request('/mcp-manager/agents', {
      headers: profileHeaders(),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ agents: [] })
  })

  it('keeps injected agent routes behind app-origin auth', async () => {
    const agentRoutes = new Hono<Env>().post('/guard-check', (c) =>
      c.json({ ok: true }),
    )
    const app = createTestApp(agentRoutes)

    const blocked = await app.request('/agents/guard-check', {
      method: 'POST',
      headers: profileHeaders(),
    })
    expect(blocked.status).toBe(403)

    const allowed = await app.request('/agents/guard-check', {
      method: 'POST',
      headers: profileHeaders({
        Origin: 'chrome-extension://biedncddmddkpapdplhcnkhhplnfgbif',
      }),
    })
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toEqual({ ok: true })
  })

  it('rejects user-data routes without a profile header', async () => {
    const response = await createTestApp().request('/chat/history')
    expect(response.status).toBe(400)
  })
})
