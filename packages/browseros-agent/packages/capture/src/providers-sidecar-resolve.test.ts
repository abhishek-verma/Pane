/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLocalAsrSidecar } from './providers'

describe('resolveLocalAsrSidecar', () => {
  const prevSidecar = process.env.BROWSEROS_ASR_SIDECAR
  const prevScript = process.env.BROWSEROS_ASR_SIDECAR_SCRIPT
  const prevResources = process.env.BROWSEROS_RESOURCES_DIR

  afterEach(() => {
    if (prevSidecar === undefined) delete process.env.BROWSEROS_ASR_SIDECAR
    else process.env.BROWSEROS_ASR_SIDECAR = prevSidecar
    if (prevScript === undefined)
      delete process.env.BROWSEROS_ASR_SIDECAR_SCRIPT
    else process.env.BROWSEROS_ASR_SIDECAR_SCRIPT = prevScript
    if (prevResources === undefined) delete process.env.BROWSEROS_RESOURCES_DIR
    else process.env.BROWSEROS_RESOURCES_DIR = prevResources
  })

  it('prefers BROWSEROS_RESOURCES_DIR bundled bun + sidecar', () => {
    const root = mkdtempSync(join(tmpdir(), 'asr-resources-'))
    const bunPath = join(root, 'bin', 'third_party', 'bun')
    const scriptPath = join(root, 'asr', 'bun-sidecar', 'sidecar.ts')
    mkdirSync(join(root, 'bin', 'third_party'), { recursive: true })
    mkdirSync(join(root, 'asr', 'bun-sidecar'), { recursive: true })
    writeFileSync(bunPath, '#!/bin/sh\n')
    writeFileSync(scriptPath, '// sidecar\n')
    delete process.env.BROWSEROS_ASR_SIDECAR
    process.env.BROWSEROS_RESOURCES_DIR = root

    const resolved = resolveLocalAsrSidecar()
    expect(resolved.command).toBe(bunPath)
    expect(resolved.args).toEqual([scriptPath])
  })

  it('honors explicit BROWSEROS_ASR_SIDECAR override', () => {
    process.env.BROWSEROS_ASR_SIDECAR = '/custom/bun'
    process.env.BROWSEROS_ASR_SIDECAR_SCRIPT = '/custom/sidecar.ts'
    const resolved = resolveLocalAsrSidecar()
    expect(resolved.command).toBe('/custom/bun')
    expect(resolved.args).toEqual(['/custom/sidecar.ts'])
  })
})
