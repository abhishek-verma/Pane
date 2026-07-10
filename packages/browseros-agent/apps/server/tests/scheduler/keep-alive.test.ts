/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildLaunchAgentPlist,
  createMacKeepAliveService,
  LAUNCH_AGENT_LABEL,
  resolveServerProgramArguments,
} from '../../src/scheduler/keep-alive'

describe('macOS keep-alive (M5.3)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('plist contains ProgramArguments and KeepAlive', () => {
    const args = resolveServerProgramArguments({
      bunPath: '/usr/local/bin/bun',
      serverEntry: '/app/server/src/index.ts',
      serverOnlyFlag: '--server-only',
    })
    const plist = buildLaunchAgentPlist(args)
    expect(plist).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`)
    expect(plist).toContain('<key>ProgramArguments</key>')
    expect(plist).toContain('<string>/usr/local/bin/bun</string>')
    expect(plist).toContain('<string>--server-only</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<true/>')
    expect(plist).toContain('<key>RunAtLoad</key>')
  })

  it('install writes plist and uninstall removes it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'browseros-keepalive-'))
    tempDirs.push(home)
    const svc = createMacKeepAliveService({
      home,
      programArguments: ['/bin/echo', 'pane-server'],
    })
    const before = await svc.status()
    expect(before.installed).toBe(false)
    expect(before.implemented).toBe(true)

    const installed = await svc.install()
    expect(installed.installed).toBe(true)
    expect(installed.plistPath).toBeTruthy()
    const body = readFileSync(installed.plistPath!, 'utf-8')
    expect(body).toContain('pane-server')

    const uninstalled = await svc.uninstall()
    expect(uninstalled.installed).toBe(false)
  })
})
