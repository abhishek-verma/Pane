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

/**
 * Returns a denial reason when the shell command appears to touch private
 * BrowserOS state. Allows ~/.browseros/tool-output (generated artifacts).
 */
export function denyBrowserosPrivateBashCommand(
  command: string,
): string | null {
  const soft = [
    '/.browseros/capture',
    '/.browseros-dev/capture',
    '/.browseros/db',
    '/.browseros-dev/db',
    '/.browseros/memories',
    '/.browseros-dev/memories',
    '/.browseros/agents',
    '/.browseros-dev/agents',
    '~/.browseros/capture',
    '~/.browseros-dev/capture',
    '$HOME/.browseros/capture',
    '$BROWSEROS_DIR/capture',
  ]
  const lower = command.toLowerCase()
  for (const needle of soft) {
    if (lower.includes(needle.toLowerCase())) {
      return 'Commands may not access Pane capture/memory/db paths. Use capture_* / context_* / memory_* tools instead.'
    }
  }

  const stateRoot = resolve(getBrowserosDir())
  const outputRoot = resolve(toolOutputRoot())
  if (
    command.includes(stateRoot) &&
    !command.includes(outputRoot) &&
    !lower.includes('/tool-output')
  ) {
    // Allow if the only mention is tool-output under the same root.
    const withoutOutput = command.split(outputRoot).join('')
    if (withoutOutput.includes(stateRoot)) {
      return `Commands may not access private Pane state under ${stateRoot} (except tool-output). Use capture_* / context_* / memory_* tools instead.`
    }
  }

  // Token scan for ~/...browseros/... paths
  const re =
    /(?:~|\$HOME)\/(?:\.browseros|\.browseros-dev)\/([A-Za-z0-9._-]+)/gi
  let match: RegExpExecArray | null = re.exec(command)
  while (match) {
    const segment = match[1]?.toLowerCase()
    if (segment && segment !== 'tool-output') {
      return 'Commands may not access private Pane state under ~/.browseros (except tool-output). Use capture_* / context_* / memory_* tools instead.'
    }
    match = re.exec(command)
  }

  // Absolute path tokens under the live BrowserOS dir
  const absRe = /(?:^|[\s"'`])((?:\/|[A-Za-z]:\\)[^\s"'`]+)/g
  match = absRe.exec(command)
  while (match) {
    const expanded = resolve(expandHome(match[1]))
    if (isUnder(stateRoot, expanded) && !isUnder(outputRoot, expanded)) {
      return `Commands may not access private Pane state under ${stateRoot} (except tool-output). Use capture_* / context_* / memory_* tools instead.`
    }
    match = absRe.exec(command)
  }

  return null
}
