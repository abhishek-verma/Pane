import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { Hono } from 'hono'
import { setConversationContext } from '../../../../src/agent/conversation-context-store'
import { optionalProfile } from '../../../../src/api/middleware/optional-profile'
import { createMcpRoutes } from '../../../../src/api/routes/mcp'
import { buildBrowserOsSelfMcpEntry } from '../../../../src/lib/agents/acpx-provider/buildBrowserOsSelfMcp'
import { closeDb, getDbHandle, initializeDb } from '../../../../src/lib/db'
import { runWithProfileAsync } from '../../../../src/lib/profile-context'
import {
  listPendingApprovals,
  resolveByToken,
  signalApprovalResolved,
} from '../../../../src/scheduler/approvals'

describe('first ACP memory call over HTTP MCP', () => {
  const originalRoot = process.env.BROWSEROS_DIR
  let root: string
  afterEach(() => {
    closeDb()
    if (originalRoot === undefined) delete process.env.BROWSEROS_DIR
    else process.env.BROWSEROS_DIR = originalRoot
    if (root) rmSync(root, { recursive: true, force: true })
  })

  for (const provider of ['codex', 'claude-code']) {
    for (const allow of [true, false]) {
      it(`${provider}: first write ${allow ? 'with trust' : 'after approval'} reaches the correct fresh profile`, async () => {
        root = mkdtempSync(join(tmpdir(), 'pane-first-memory-'))
        process.env.BROWSEROS_DIR = root
        initializeDb()
        const profileId = crypto.randomUUID()
        const conversationId = crypto.randomUUID()
        await runWithProfileAsync(profileId, async () => {
          setConversationContext(
            conversationId,
            {
              pins: allow ? { 'write-local': { pinned: true } } : {},
              isNewUser: true,
              runConsequentialCount: { count: 0 },
            },
            { conversationId, providerId: provider, bucketId: 'default' },
          )
        })
        const self = buildBrowserOsSelfMcpEntry({
          serverPort: 9100,
          profileId,
          conversationId,
          providerId: provider,
        })
        if (self.type !== 'http') throw new Error('Expected HTTP')
        const app = new Hono()
        app.use('/mcp', optionalProfile())
        app.route(
          '/mcp',
          createMcpRoutes({
            version: 'test',
            browserSession: { pages: {} } as unknown as BrowserSession,
            executionDir: root,
          }),
        )
        const headers = {
          ...Object.fromEntries(
            self.headers.map(({ name, value }) => [name, value]),
          ),
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        }
        let settled = false
        const response = app
          .request('/mcp', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: 'memory_add',
                arguments: {
                  content: 'Project management is moving to Linear.',
                },
              },
            }),
          })
          .then((r) => {
            settled = true
            return r
          })
        if (!allow) {
          await runWithProfileAsync(profileId, async () => {
            let pending = listPendingApprovals()
            for (let i = 0; i < 100 && !pending.length; i++) {
              await new Promise((resolve) => setTimeout(resolve, 5))
              pending = listPendingApprovals()
            }
            expect(pending).toHaveLength(1)
            expect(pending[0].conversationId).toBe(conversationId)
            expect(settled).toBe(false)
            expect(
              getDbHandle()
                .sqlite.query('SELECT count(*) AS n FROM memory_entries')
                .get(),
            ).toEqual({ n: 0 })
            const resolved = resolveByToken(pending[0].approveToken)
            if (!resolved) throw new Error('Approval missing')
            signalApprovalResolved(resolved.approval.id, resolved.resolution)
          })
        }
        const result = await response
        expect(result.status).toBe(200)
        const body = await result.json()
        expect(body.result.isError).toBe(false)
        expect(body.result.content[0].text).toContain('Remembered')
        const file = join(root, 'profiles', profileId, 'memories', 'MEMORY.md')
        expect(readFileSync(file, 'utf8')).toContain(
          'Project management is moving to Linear.',
        )
      })
    }
  }
})
