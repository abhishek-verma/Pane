/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Opt-in macOS LaunchAgent that starts the agent server at login
 * without the full Chromium UI.
 */

import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { KEEP_ALIVE_DEFAULT_SERVER_PORT } from '../config'
import { logger } from '../lib/logger'

export const LAUNCH_AGENT_LABEL = 'com.browseros.agent-server'
export const LAUNCH_AGENT_PLIST = `~/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist`

export interface KeepAliveStatus {
  platform: NodeJS.Platform
  installed: boolean
  plistPath: string | null
  implemented: boolean
  /** Honest limitation copy for UI */
  limitations: string[]
}

export interface KeepAliveService {
  install(): Promise<KeepAliveStatus>
  uninstall(): Promise<KeepAliveStatus>
  status(): Promise<KeepAliveStatus>
}

const LIMITATIONS = [
  'Keep-alive starts the agent server at login — not the full browser UI.',
  'Jobs that need browser tools require a browser process; they skip cleanly if none is available.',
  'A closed laptop lid or powered-off machine does not run scheduled work.',
  'Non-browser work can fire while the machine is awake with keep-alive on.',
]

export function launchAgentsDir(home = homedir()): string {
  return join(home, 'Library', 'LaunchAgents')
}

export function plistPath(home = homedir()): string {
  return join(launchAgentsDir(home), `${LAUNCH_AGENT_LABEL}.plist`)
}

/**
 * Resolve the server binary / entry for Dev vs release.
 * Dev: bun + apps/server/src/index.ts (or packaged bun binary).
 * Release: packaged browseros-server next to the app (TODO: finalize path).
 */
export function resolveServerProgramArguments(options?: {
  bunPath?: string
  serverEntry?: string
  serverOnlyFlag?: string
  serverPort?: number
}): string[] {
  const bunPath = options?.bunPath ?? process.execPath
  const serverEntry =
    options?.serverEntry ??
    join(
      // From apps/server/src/scheduler → monorepo apps/server/src/index.ts
      dirname(new URL(import.meta.url).pathname),
      '..',
      'index.ts',
    )
  const serverPort = options?.serverPort ?? KEEP_ALIVE_DEFAULT_SERVER_PORT
  return [
    bunPath,
    serverEntry,
    options?.serverOnlyFlag ?? '--server-only',
    '--server-port',
    String(serverPort),
  ]
}

export function buildLaunchAgentPlist(programArguments: string[]): string {
  const argsXml = programArguments
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'BrowserOS', 'agent-server.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'BrowserOS', 'agent-server.err.log')}</string>
</dict>
</plist>
`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export function createMacKeepAliveService(options?: {
  home?: string
  programArguments?: string[]
}): KeepAliveService {
  const home = options?.home ?? homedir()
  const path = plistPath(home)

  return {
    async status() {
      const installed = await fileExists(path)
      return {
        platform: 'darwin',
        installed,
        plistPath: installed ? path : null,
        implemented: true,
        limitations: LIMITATIONS,
      }
    },
    async install() {
      const args = options?.programArguments ?? resolveServerProgramArguments()
      await mkdir(dirname(path), { recursive: true })
      await mkdir(join(home, 'Library', 'Logs', 'BrowserOS'), {
        recursive: true,
      })
      const plist = buildLaunchAgentPlist(args)
      await writeFile(path, plist, 'utf-8')
      await chmod(path, 0o644)
      logger.info('keep-alive LaunchAgent installed', { path })
      // Best-effort load; may fail in sandbox — install still succeeded.
      try {
        const proc = Bun.spawn(['launchctl', 'load', '-w', path], {
          stdout: 'ignore',
          stderr: 'ignore',
        })
        await proc.exited
      } catch {
        logger.warn('launchctl load failed — plist written; load on next login')
      }
      return this.status()
    },
    async uninstall() {
      try {
        const proc = Bun.spawn(['launchctl', 'unload', '-w', path], {
          stdout: 'ignore',
          stderr: 'ignore',
        })
        await proc.exited
      } catch {
        // ignore
      }
      try {
        await unlink(path)
      } catch {
        // already gone
      }
      logger.info('keep-alive LaunchAgent uninstalled', { path })
      return this.status()
    },
  }
}

export function createKeepAliveService(): KeepAliveService {
  if (process.platform === 'darwin') {
    return createMacKeepAliveService()
  }
  return {
    async status() {
      return {
        platform: process.platform,
        installed: false,
        plistPath: null,
        implemented: false,
        limitations: [
          ...LIMITATIONS,
          `Keep-alive install is not implemented on ${process.platform} in v0.5 (macOS only).`,
        ],
      }
    },
    async install() {
      throw new Error(
        `Keep-alive is not implemented on ${process.platform}. macOS only in v0.5.`,
      )
    },
    async uninstall() {
      return this.status()
    },
  }
}

/** When a keep-alive job needs browser tools but none are available. */
export function browserMissingSkipReason(): string {
  return 'Browser tools required but no browser is available (keep-alive server-only mode). Skipped.'
}
