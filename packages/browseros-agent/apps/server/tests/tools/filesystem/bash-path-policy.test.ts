/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { denyBrowserosPrivateBashCommand } from '../../../src/tools/filesystem/bash-path-policy'

describe('denyBrowserosPrivateBashCommand', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'browseros-bash-policy-'))
    process.env.BROWSEROS_DIR = dir
  })

  afterEach(() => {
    delete process.env.BROWSEROS_DIR
  })

  it('allows ordinary workspace commands', () => {
    expect(denyBrowserosPrivateBashCommand('ls -la')).toBeNull()
    expect(denyBrowserosPrivateBashCommand('echo hello')).toBeNull()
  })

  it('denies capture/memory/db paths under ~/.browseros', () => {
    expect(
      denyBrowserosPrivateBashCommand('cat ~/.browseros/capture/foo.json'),
    ).not.toBeNull()
    expect(
      denyBrowserosPrivateBashCommand('python3 ~/.browseros/memories/x.md'),
    ).not.toBeNull()
    expect(
      denyBrowserosPrivateBashCommand(`sqlite3 ${join(dir, 'db', 'x.sqlite')}`),
    ).not.toBeNull()
  })

  it('allows tool-output under the BrowserOS dir', () => {
    const toolOut = join(dir, 'tool-output', 'snapshot.txt')
    expect(denyBrowserosPrivateBashCommand(`cat ${toolOut}`)).toBeNull()
  })
})
