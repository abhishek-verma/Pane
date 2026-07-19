/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import { type Subprocess, spawn } from 'bun'
import { logger } from '../lib/logger'
import { pingEmbedWorker, setEmbedWorkerUrl } from './embed-client'

let child: Subprocess | null = null
const DEFAULT_PORT = 9210

export async function startEmbedWorkerProcess(
  port = DEFAULT_PORT,
): Promise<void> {
  const url = `http://127.0.0.1:${port}`
  // Reuse if already healthy (e.g. external worker)
  setEmbedWorkerUrl(url)
  if (await pingEmbedWorker()) {
    logger.info('Embed worker already running', { url })
    return
  }

  const workerPath = join(import.meta.dir, 'embed-worker.ts')
  try {
    child = spawn({
      cmd: [process.execPath, workerPath, '--port', String(port)],
      stdout: 'ignore',
      stderr: 'ignore',
      env: { ...process.env, PANE_EMBED_PORT: String(port) },
    })
    child.unref?.()
    // Wait briefly for health
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(100)
      if (await pingEmbedWorker()) {
        logger.info('Embed worker started', { url, pid: child.pid })
        return
      }
    }
    logger.warn(
      'Embed worker did not become healthy; using in-process hash embed',
    )
    setEmbedWorkerUrl(null)
  } catch (err) {
    logger.warn('Failed to spawn embed worker', { err: String(err) })
    setEmbedWorkerUrl(null)
  }
}

export function stopEmbedWorkerProcess(): void {
  if (child) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    child = null
  }
  setEmbedWorkerUrl(null)
}
