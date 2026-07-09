/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Subscribe terminal-session events into the context graph (once per process).
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { onTerminalSession } from '../tools/filesystem/sessions'
import { ingestTerminalSession } from './ingest'

let subscribed = false

export function subscribeTerminalIngest(): void {
  if (subscribed) return
  subscribed = true
  onTerminalSession((event) => {
    ingestTerminalSession({
      bucketId: event.bucketId || DEFAULT_BUCKET_ID,
      workspaceKey: event.workspaceKey,
      sessionId: event.session.id,
      sessionName: event.session.name,
      cwd: event.session.cwd,
      command: event.command,
      exitCode: event.exitCode,
    })
  })
}
