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

export const LAUNCH_AGENT_LABEL = 'com.pane.agent-server'
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
 * Release: packaged browseros-server inside the .app bundle (Contents/Resources/).
 */
export function resolveServerProgramArguments(options?: {
  bunPath?: string
  serverEntry?: string
  serverOnlyFlag?: string
  serverPort?: number
}): string[] {
  const serverPort = options?.serverPort ?? KEEP_ALIVE_DEFAULT_SERVER_PORT

  if (options?.bunPath || options?.serverEntry) {
    return [
      options.bunPath ?? process.execPath,
      options.serverEntry ??
        join(dirname(new URL(import.meta.url).pathname), '..', 'index.ts'),
      options.serverOnlyFlag ?? '--server-only',
      '--server-port',
      String(serverPort),
    ]
  }

  const releaseServerBinary = resolveReleaseServerBinary()
  if (releaseServerBinary) {
    return [
      releaseServerBinary,
      '--server-only',
      '--server-port',
      String(serverPort),
    ]
  }

  const bunPath = process.execPath
  const serverEntry = join(
    dirname(new URL(import.meta.url).pathname),
    '..',
    'index.ts',
  )
  return [
    bunPath,
    serverEntry,
    '--server-only',
    '--server-port',
    String(serverPort),
  ]
}

function resolveReleaseServerBinary(): string | null {
  if (process.platform === 'darwin') {
    const execDir = dirname(process.execPath)
    const candidates = [
      join(execDir, '..', 'Resources', 'browseros-server'),
      join(execDir, 'browseros-server'),
    ]
    for (const candidate of candidates) {
      try {
        Bun.file(candidate)
        return candidate
      } catch {}
    }
  }
  if (process.platform === 'win32') {
    const execDir = dirname(process.execPath)
    const candidate = join(execDir, 'browseros-server.exe')
    try {
      Bun.file(candidate)
      return candidate
    } catch {
      return null
    }
  }
  if (process.platform === 'linux') {
    const execDir = dirname(process.execPath)
    const candidate = join(execDir, 'browseros-server')
    try {
      Bun.file(candidate)
      return candidate
    } catch {
      return null
    }
  }
  return null
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
  <string>${join(homedir(), 'Library', 'Logs', 'Pane', 'agent-server.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'Pane', 'agent-server.err.log')}</string>
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
      await mkdir(join(home, 'Library', 'Logs', 'Pane'), {
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
  if (process.platform === 'win32') {
    return createWindowsKeepAliveService()
  }
  if (process.platform === 'linux') {
    return createLinuxKeepAliveService()
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
          `Keep-alive is not available on ${process.platform}.`,
        ],
      }
    },
    async install() {
      throw new Error(`Keep-alive is not implemented on ${process.platform}.`)
    },
    async uninstall() {
      return this.status()
    },
  }
}

const WINDOWS_TASK_NAME = 'PaneAgentServer'

export function createWindowsKeepAliveService(): KeepAliveService {
  return {
    async status() {
      let installed = false
      try {
        const proc = Bun.spawn(
          ['schtasks', '/query', '/tn', WINDOWS_TASK_NAME],
          { stdout: 'pipe', stderr: 'ignore' },
        )
        await proc.exited
        installed = proc.exitCode === 0
      } catch {
        // schtasks not available or task doesn't exist
      }
      return {
        platform: 'win32',
        installed,
        plistPath: null,
        implemented: true,
        limitations: LIMITATIONS,
      }
    },
    async install() {
      const args = resolveServerProgramArguments()
      const command = args[0]
      const taskArgs = args.slice(1).join(' ')
      try {
        const proc = Bun.spawn(
          [
            'schtasks',
            '/create',
            '/tn',
            WINDOWS_TASK_NAME,
            '/tr',
            `"${command}" ${taskArgs}`,
            '/sc',
            'ONLOGON',
            '/rl',
            'LIMITED',
            '/f',
          ],
          { stdout: 'ignore', stderr: 'pipe' },
        )
        await proc.exited
        if (proc.exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text()
          throw new Error(`schtasks failed: ${stderr}`)
        }
      } catch (e) {
        logger.error('Windows keep-alive install failed', {
          error: e instanceof Error ? e.message : String(e),
        })
        throw e
      }
      logger.info('keep-alive Task Scheduler entry installed', {
        task: WINDOWS_TASK_NAME,
      })
      return this.status()
    },
    async uninstall() {
      try {
        const proc = Bun.spawn(
          ['schtasks', '/delete', '/tn', WINDOWS_TASK_NAME, '/f'],
          { stdout: 'ignore', stderr: 'ignore' },
        )
        await proc.exited
      } catch {
        // ignore
      }
      logger.info('keep-alive Task Scheduler entry removed', {
        task: WINDOWS_TASK_NAME,
      })
      return this.status()
    },
  }
}

const SYSTEMD_UNIT_NAME = 'pane-agent-server.service'

function systemdUnitDir(home = homedir()): string {
  return join(home, '.config', 'systemd', 'user')
}

function systemdUnitPath(home = homedir()): string {
  return join(systemdUnitDir(home), SYSTEMD_UNIT_NAME)
}

function buildSystemdUnit(programArguments: string[]): string {
  const execStart = programArguments.join(' ')
  return `[Unit]
Description=Pane Agent Server
After=default.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`
}

export function createLinuxKeepAliveService(options?: {
  home?: string
  programArguments?: string[]
}): KeepAliveService {
  const home = options?.home ?? homedir()
  const unitPath = systemdUnitPath(home)

  return {
    async status() {
      const installed = await fileExists(unitPath)
      return {
        platform: 'linux',
        installed,
        plistPath: installed ? unitPath : null,
        implemented: true,
        limitations: LIMITATIONS,
      }
    },
    async install() {
      const args = options?.programArguments ?? resolveServerProgramArguments()
      await mkdir(systemdUnitDir(home), { recursive: true })
      const unit = buildSystemdUnit(args)
      await writeFile(unitPath, unit, 'utf-8')
      logger.info('keep-alive systemd user unit installed', { path: unitPath })
      try {
        const proc = Bun.spawn(
          ['systemctl', '--user', 'enable', '--now', SYSTEMD_UNIT_NAME],
          { stdout: 'ignore', stderr: 'ignore' },
        )
        await proc.exited
      } catch {
        logger.warn(
          'systemctl enable failed — unit written; enable on next login',
        )
      }
      return this.status()
    },
    async uninstall() {
      try {
        const proc = Bun.spawn(
          ['systemctl', '--user', 'disable', '--now', SYSTEMD_UNIT_NAME],
          { stdout: 'ignore', stderr: 'ignore' },
        )
        await proc.exited
      } catch {
        // ignore
      }
      try {
        await unlink(unitPath)
      } catch {
        // already gone
      }
      logger.info('keep-alive systemd user unit uninstalled', {
        path: unitPath,
      })
      return this.status()
    },
  }
}

/** When a keep-alive job needs browser tools but none are available. */
export function browserMissingSkipReason(): string {
  return 'Browser tools required but no browser is available (keep-alive server-only mode). Skipped.'
}
