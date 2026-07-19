import { buildBrowserActionDetail } from './browser-evidence'
import { classifyToolVisibility, isSpecializedKind } from './classify'
import { extractToolOutput } from './extract-output'
import { buildFileChangeDetail, formatFileStats } from './file-evidence'
import { buildGenericDetail } from './generic-evidence'
import { mapInvocationState } from './map-state'
import type { ToolEvidence } from './types'

export interface BuildToolEvidenceArgs {
  toolCallId: string
  toolName: string
  state: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
  label?: string
  subject?: string
  detailsUnavailable?: boolean
}

export function buildToolEvidence(args: BuildToolEvidenceArgs): ToolEvidence {
  const toolName = args.toolName.replace(/^tool-/, '')
  const kind = classifyToolVisibility(toolName)
  const state = mapInvocationState(args.state)
  const input = args.input ?? {}
  const extracted = extractToolOutput(args.output)
  const isError = state === 'error' || extracted.isError
  const errorText =
    args.errorText || (isError ? extracted.text || 'Tool failed' : undefined)

  if (state === 'approval') {
    return {
      toolCallId: args.toolCallId,
      toolName,
      kind,
      state,
      specialized: false,
      title: args.label ?? toolName,
    }
  }

  if (state === 'running') {
    const runningTitle =
      kind === 'file-change' && typeof input.path === 'string'
        ? `Editing \`${input.path}\`…`
        : kind === 'browser-action'
          ? toolName === 'navigate'
            ? 'Navigating…'
            : 'Acting…'
          : (args.label ?? toolName)
    return {
      toolCallId: args.toolCallId,
      toolName,
      kind,
      state,
      specialized: isSpecializedKind(kind),
      title: runningTitle,
      browser:
        kind === 'browser-action' || kind === 'screenshot'
          ? {
              caption: runningTitle,
              media: [],
            }
          : undefined,
      file:
        kind === 'file-change' && typeof input.path === 'string'
          ? {
              path: input.path,
              kind: 'edit',
              diffLines: [],
            }
          : undefined,
    }
  }

  if (kind === 'file-change' && state === 'completed' && !isError) {
    const file = buildFileChangeDetail({
      toolName,
      input,
      outputText: extracted.text,
      isError: false,
    })
    if (file) {
      const stats = formatFileStats(file)
      return {
        toolCallId: args.toolCallId,
        toolName,
        kind,
        state,
        specialized: true,
        title: `${file.kind === 'create' ? 'Created' : 'Edited'} ${file.path}${stats ? `  ${stats}` : ''}`,
        file,
      }
    }
  }

  if (
    (kind === 'browser-action' || kind === 'screenshot') &&
    (state === 'completed' || state === 'error')
  ) {
    const browser = buildBrowserActionDetail({
      toolName,
      input,
      outputText: extracted.text,
      structured: extracted.structured,
      images: extracted.images,
    })
    // Harness/history often has label/subject without full act input.
    if (args.label) {
      const subject =
        args.subject && !args.label.includes(args.subject)
          ? ` ${args.subject}`
          : ''
      const host =
        browser.hostname && toolName === 'act' ? ` · ${browser.hostname}` : ''
      browser.caption = `${args.label}${subject}${host}`
    }
    if (args.detailsUnavailable && browser.media.length === 0) {
      browser.pageDiffSummary =
        browser.pageDiffSummary ?? 'Details unavailable for this run'
    }
    return {
      toolCallId: args.toolCallId,
      toolName,
      kind,
      state: isError ? 'error' : state,
      specialized: true,
      title: browser.caption,
      errorText,
      browser,
    }
  }

  const generic = buildGenericDetail({
    toolName,
    input,
    outputText: extracted.text,
    label: args.label,
    subject: args.subject,
    detailsUnavailable: args.detailsUnavailable,
  })

  return {
    toolCallId: args.toolCallId,
    toolName,
    kind: 'generic',
    state: isError ? 'error' : state,
    specialized: false,
    title: generic.title,
    errorText,
    generic,
  }
}
