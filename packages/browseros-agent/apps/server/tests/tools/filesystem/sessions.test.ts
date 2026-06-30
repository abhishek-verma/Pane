import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getTerminalSessionCwd,
  listTerminalSessions,
  notifyTerminalSessionRun,
  onTerminalSession,
  openTerminalSession,
  resolveSessionCd,
  updateTerminalSessionCwd,
} from '../../../src/tools/filesystem/sessions'
import { defaultWorkspace } from '../../../src/tools/filesystem/workspace'

describe('terminal sessions', () => {
  let tmpDir: string
  let workspace: ReturnType<typeof defaultWorkspace>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pane-sessions-'))
    await mkdir(join(tmpDir, 'sub'), { recursive: true })
    workspace = defaultWorkspace(tmpDir, {
      workspaceId: `ws-${tmpDir.split('/').pop()}`,
      bucketId: 'default',
    })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('open and list sessions', async () => {
    const session = await openTerminalSession(workspace, 'build')
    const listed = await listTerminalSessions(workspace)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(session.id)
    expect(listed[0]?.name).toBe('build')
  })

  test('persists cwd across reads', async () => {
    const session = await openTerminalSession(workspace)
    await updateTerminalSessionCwd(workspace, session.id, join(tmpDir, 'sub'))
    const cwd = await getTerminalSessionCwd(workspace, session.id)
    expect(cwd).toBe(join(tmpDir, 'sub'))
  })

  test('resolveSessionCd tracks cd inside workspace', async () => {
    const root = await realpath(tmpDir)
    const next = await resolveSessionCd(workspace, root, 'cd sub')
    expect(next).toBe(join(root, 'sub'))
  })

  test('resolveSessionCd rejects escape via cd', async () => {
    const root = await realpath(tmpDir)
    const next = await resolveSessionCd(workspace, root, 'cd ..')
    expect(next).toBe(root)
  })

  test('onTerminalSession emits run metadata', async () => {
    const session = await openTerminalSession(workspace)
    const events: Array<{ command: string; exitCode: number }> = []
    const unsubscribe = onTerminalSession((event) => {
      events.push({ command: event.command, exitCode: event.exitCode })
    })

    notifyTerminalSessionRun(workspace, session, 'echo hi', 0)
    unsubscribe()

    expect(events).toEqual([{ command: 'echo hi', exitCode: 0 }])
  })
})
