/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Keep filesystem_bash from reading private Pane state under ~/.browseros
 * (capture, db, memories, agents). Tool-output paths remain allowed.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import { getBrowserosDir } from '../../lib/browseros-dir'

const DENY_REASON =
  'Commands may not access private Pane state under ~/.browseros (except tool-output). Use capture_* / context_* / memory_* tools instead.'

function toolOutputRoot(): string {
  return join(getBrowserosDir(), PATHS.TOOL_OUTPUT_DIR_NAME)
}

function expandHome(pathLike: string): string {
  if (pathLike === '~') return homedir()
  if (pathLike.startsWith('~/') || pathLike.startsWith('~\\')) {
    return join(homedir(), pathLike.slice(2))
  }
  return pathLike
}

function isUnder(root: string, candidate: string): boolean {
  if (candidate === root) return true
  const prefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`
  const winPrefix = root.endsWith('\\') ? root : `${root}\\`
  return candidate.startsWith(prefix) || candidate.startsWith(winPrefix)
}

function expandEnvForScan(command: string, stateRoot: string): string {
  return command
    .replace(/\$\{BROWSEROS_DIR\}/g, stateRoot)
    .replace(/\$BROWSEROS_DIR/g, stateRoot)
    .replace(/\$\{HOME\}/g, homedir())
    .replace(/\$HOME/g, homedir())
    .replace(/(^|[\s"'`=])~\//g, `$1${homedir()}/`)
}

/** True when a `.browseros` / `.browseros-dev` path is not under tool-output. */
function mentionsPrivateBrowserosPath(command: string): boolean {
  const re = /\.browseros(?:-dev)?(\/[A-Za-z0-9._-]*)?/gi
  let match: RegExpExecArray | null = re.exec(command)
  while (match) {
    const segment = (match[1] ?? '').toLowerCase()
    if (!segment || segment === '/') return true
    if (!segment.startsWith(`/${PATHS.TOOL_OUTPUT_DIR_NAME}`)) return true
    match = re.exec(command)
  }
  return false
}

/**
 * Returns a denial reason when the shell command appears to touch private
 * BrowserOS state. Allows ~/.browseros/tool-output (generated artifacts).
 */
export function denyBrowserosPrivateBashCommand(
  command: string,
): string | null {
  const stateRoot = resolve(getBrowserosDir())
  const outputRoot = resolve(toolOutputRoot())

  // $BROWSEROS_DIR / ${BROWSEROS_DIR} — allow only .../tool-output
  const envRef = /\$\{?BROWSEROS_DIR\}?(\/[A-Za-z0-9._-]*)?/gi
  let match: RegExpExecArray | null = envRef.exec(command)
  while (match) {
    const rest = (match[1] ?? '').toLowerCase()
    if (!rest || rest === '/') return DENY_REASON
    if (!rest.startsWith(`/${PATHS.TOOL_OUTPUT_DIR_NAME}`)) return DENY_REASON
    match = envRef.exec(command)
  }

  if (mentionsPrivateBrowserosPath(command)) return DENY_REASON

  const expanded = expandEnvForScan(command, stateRoot)
  if (expanded.includes(stateRoot)) {
    const withoutOutput = expanded.split(outputRoot).join('')
    if (withoutOutput.includes(stateRoot)) return DENY_REASON
  }

  // Absolute / home-expanded path tokens under the live BrowserOS dir
  const absRe = /(?:^|[\s"'`])((?:\/|[A-Za-z]:\\)[^\s"'`]+)/g
  match = absRe.exec(expanded)
  while (match) {
    const candidate = resolve(expandHome(match[1]))
    if (isUnder(stateRoot, candidate) && !isUnder(outputRoot, candidate)) {
      return DENY_REASON
    }
    match = absRe.exec(expanded)
  }

  return null
}
