import { buildAppSendDetail } from './app-send-evidence'
import { buildBrowserActionDetail } from './browser-evidence'
import { classifyToolVisibility, isSpecializedKind } from './classify'
import { type ExtractedToolOutput, extractToolOutput } from './extract-output'
import { buildFileChangeDetail, formatFileStats } from './file-evidence'
import { buildGenericDetail } from './generic-evidence'
import { mapInvocationState } from './map-state'
import { buildTerminalDetail } from './terminal-evidence'
import type {
  ToolEvidence,
  ToolEvidenceState,
  ToolVisibilityKind,
} from './types'

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

function runningTitleFor(
  kind: ToolVisibilityKind,
  toolName: string,
  input: Record<string, unknown>,
  label?: string,
): string {
  if (kind === 'file-change' && typeof input.path === 'string') {
    return `Editing \`${input.path}\`…`
  }
  if (kind === 'browser-action') {
    return toolName === 'navigate' ? 'Navigating…' : 'Acting…'
  }
  if (kind === 'terminal') {
    const command = typeof input.command === 'string' ? input.command : ''
    return command ? `$ ${command}` : 'Running command…'
  }
  if (kind === 'app-send') return label ?? 'Sending…'
  return label ?? toolName
}

function buildRunningEvidence(args: {
  toolCallId: string
  toolName: string
  kind: ToolVisibilityKind
  input: Record<string, unknown>
  label?: string
}): ToolEvidence {
  const title = runningTitleFor(
    args.kind,
    args.toolName,
    args.input,
    args.label,
  )
  const command =
    typeof args.input.command === 'string' ? args.input.command : ''
  return {
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    kind: args.kind,
    state: 'running',
    specialized: isSpecializedKind(args.kind),
    title,
    browser:
      args.kind === 'browser-action' || args.kind === 'screenshot'
        ? { caption: title, media: [] }
        : undefined,
    file:
      args.kind === 'file-change' && typeof args.input.path === 'string'
        ? { path: args.input.path, kind: 'edit', diffLines: [] }
        : undefined,
    terminal: args.kind === 'terminal' ? { command } : undefined,
    appSend: args.kind === 'app-send' ? { title } : undefined,
  }
}

function buildFileEvidence(args: {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  outputText: string
}): ToolEvidence | null {
  const file = buildFileChangeDetail({
    toolName: args.toolName,
    input: args.input,
    outputText: args.outputText,
    isError: false,
  })
  if (!file) return null
  const stats = formatFileStats(file)
  return {
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    kind: 'file-change',
    state: 'completed',
    specialized: true,
    title: `${file.kind === 'create' ? 'Created' : 'Edited'} ${file.path}${stats ? `  ${stats}` : ''}`,
    file,
  }
}

function buildBrowserEvidence(args: {
  toolCallId: string
  toolName: string
  kind: 'browser-action' | 'screenshot'
  state: ToolEvidenceState
  input: Record<string, unknown>
  extracted: ExtractedToolOutput
  errorText?: string
  label?: string
  subject?: string
  detailsUnavailable?: boolean
}): ToolEvidence {
  const browser = buildBrowserActionDetail({
    toolName: args.toolName,
    input: args.input,
    outputText: args.extracted.text,
    structured: args.extracted.structured,
    images: args.extracted.images,
    strippedImages: args.extracted.strippedImages,
  })
  if (args.label) {
    const subject =
      args.subject && !args.label.includes(args.subject)
        ? ` ${args.subject}`
        : ''
    const host =
      browser.hostname && args.toolName === 'act'
        ? ` · ${browser.hostname}`
        : ''
    browser.caption = `${args.label}${subject}${host}`
  }
  if (args.detailsUnavailable && browser.media.length === 0) {
    browser.pageDiffSummary =
      browser.pageDiffSummary ?? 'Details unavailable for this run'
  }
  return {
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    kind: args.kind,
    state: args.state,
    specialized: true,
    title: browser.caption,
    errorText: args.errorText,
    browser,
  }
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
  const resolvedState: ToolEvidenceState = isError ? 'error' : state

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
    return buildRunningEvidence({
      toolCallId: args.toolCallId,
      toolName,
      kind,
      input,
      label: args.label,
    })
  }

  if (kind === 'file-change' && state === 'completed' && !isError) {
    const fileEv = buildFileEvidence({
      toolCallId: args.toolCallId,
      toolName,
      input,
      outputText: extracted.text,
    })
    if (fileEv) return fileEv
  }

  if (
    (kind === 'browser-action' || kind === 'screenshot') &&
    (state === 'completed' || state === 'error')
  ) {
    return buildBrowserEvidence({
      toolCallId: args.toolCallId,
      toolName,
      kind,
      state: resolvedState,
      input,
      extracted,
      errorText,
      label: args.label,
      subject: args.subject,
      detailsUnavailable: args.detailsUnavailable,
    })
  }

  if (kind === 'terminal' && (state === 'completed' || state === 'error')) {
    const terminal = buildTerminalDetail({
      input,
      outputText: extracted.text,
      isError,
    })
    return {
      toolCallId: args.toolCallId,
      toolName,
      kind,
      state: resolvedState,
      specialized: true,
      title: terminal.command ? `$ ${terminal.command}` : 'Command',
      errorText,
      terminal,
    }
  }

  if (kind === 'app-send' && (state === 'completed' || state === 'error')) {
    const appSend = buildAppSendDetail({
      toolName,
      input,
      outputText: extracted.text,
      label: args.label,
      subject: args.subject,
    })
    return {
      toolCallId: args.toolCallId,
      toolName,
      kind,
      state: resolvedState,
      specialized: true,
      title: appSend.title,
      errorText,
      appSend,
    }
  }

  const generic = buildGenericDetail({
    toolName,
    input,
    outputText: extracted.text,
    label: args.label,
    subject: args.subject,
    detailsUnavailable: args.detailsUnavailable,
    spilled: Boolean(
      args.output &&
        typeof args.output === 'object' &&
        (args.output as { spilled?: boolean }).spilled === true,
    ),
  })

  return {
    toolCallId: args.toolCallId,
    toolName,
    kind: 'generic',
    state: resolvedState,
    specialized: false,
    title: generic.title,
    errorText,
    generic,
  }
}
