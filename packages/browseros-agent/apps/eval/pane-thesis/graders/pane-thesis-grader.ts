/**
 * Grader for the pane-thesis-e2e scenario.
 *
 * Checks:
 * (a) The file was written with correct content (heading text)
 * (b) context_search returned a hit from example.com
 * (c) A memory entry was written containing the expected substring
 * (d) The action log entry for the write exists
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface GraderInput {
  taskResult: {
    messages: Array<{
      role: string
      content: string
      tool_calls?: Array<{
        function: { name: string; arguments: string }
      }>
    }>
    metadata?: Record<string, unknown>
  }
  task: {
    metadata: {
      expected_heading: string
      expected_file: string
      expected_memory_substring: string
    }
  }
  workspaceDir?: string
  browserosDir?: string
}

interface GraderResult {
  pass: boolean
  score: number
  details: {
    fileWritten: boolean
    fileContentCorrect: boolean
    contextRecallHit: boolean
    memoryWritten: boolean
    actionLogPresent: boolean
  }
  reason: string
}

export function grade(input: GraderInput): GraderResult {
  const { task, taskResult, workspaceDir, browserosDir } = input
  const { expected_heading, expected_file, expected_memory_substring } =
    task.metadata

  const messages = taskResult.messages ?? []
  const allContent = messages.map((m) => m.content ?? '').join('\n')

  // (a) File was written with correct content
  let fileWritten = false
  let fileContentCorrect = false
  if (workspaceDir) {
    const filePath = join(workspaceDir, expected_file)
    if (existsSync(filePath)) {
      fileWritten = true
      const content = readFileSync(filePath, 'utf-8').trim()
      fileContentCorrect = content
        .toLowerCase()
        .includes(expected_heading.toLowerCase())
    }
  } else {
    // Infer from tool calls in messages
    const writeCall = messages.find((m) =>
      m.tool_calls?.some(
        (tc) =>
          tc.function.name === 'filesystem_write' &&
          tc.function.arguments.includes(expected_file),
      ),
    )
    fileWritten = !!writeCall
    if (writeCall) {
      const tc = writeCall.tool_calls?.find(
        (tc) => tc.function.name === 'filesystem_write',
      )
      if (tc) {
        fileContentCorrect = tc.function.arguments.includes(expected_heading)
      }
    }
  }

  // (b) context_search returned a hit
  const contextRecallHit =
    allContent.includes('example.com') ||
    allContent.includes('Example Domain') ||
    messages.some((m) =>
      m.tool_calls?.some(
        (tc) =>
          tc.function.name === 'context_search' ||
          tc.function.name === 'context_recall',
      ),
    )

  // (c) Memory entry was written
  let memoryWritten = false
  if (browserosDir) {
    const memoryPath = join(browserosDir, 'memories', 'MEMORY.md')
    if (existsSync(memoryPath)) {
      const memContent = readFileSync(memoryPath, 'utf-8')
      memoryWritten = memContent
        .toLowerCase()
        .includes(expected_memory_substring.toLowerCase())
    }
  } else {
    memoryWritten = messages.some((m) =>
      m.tool_calls?.some((tc) => tc.function.name === 'memory_add'),
    )
  }

  // (d) Action log entry exists
  const actionLogPresent =
    allContent.includes('action log') ||
    allContent.includes('write-local') ||
    allContent.includes('filesystem_write')

  const checks = [
    fileWritten,
    fileContentCorrect,
    contextRecallHit,
    memoryWritten,
    actionLogPresent,
  ]
  const passed = checks.filter(Boolean).length
  const score = passed / checks.length
  const pass = score >= 0.8

  const reasons: string[] = []
  if (!fileWritten) reasons.push('File not written')
  if (!fileContentCorrect) reasons.push('File content incorrect')
  if (!contextRecallHit) reasons.push('Context recall did not hit')
  if (!memoryWritten) reasons.push('Memory not written')
  if (!actionLogPresent) reasons.push('Action log not found in output')

  return {
    pass,
    score,
    details: {
      fileWritten,
      fileContentCorrect,
      contextRecallHit,
      memoryWritten,
      actionLogPresent,
    },
    reason: pass
      ? `All criteria met (${passed}/5)`
      : `Failed: ${reasons.join('; ')} (${passed}/5)`,
  }
}
