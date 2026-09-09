/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { writePromptFile } from './files'
import { rebuildIndexFromFiles } from './store'

/**
 * Write a prompt file and rebuild the SQLite index from files.
 * Use for Settings / persona wholesale edits so files stay source of truth
 * for recall and always-on prompt assembly.
 */
export async function writePromptFileAndReindex(
  which: 'soul' | 'user' | 'memory',
  content: string,
  root?: string,
): Promise<void> {
  await writePromptFile(which, content, root)
  await rebuildIndexFromFiles(root)
}
