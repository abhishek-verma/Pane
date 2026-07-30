import { describeToolCall } from '@browseros/shared/trust/consequence-class'
import { GENERIC_JSON_MAX_CHARS, type GenericToolDetail } from './types'

function prettifyName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… truncated (${text.length} chars)`
}

export function buildGenericDetail(args: {
  toolName: string
  input: Record<string, unknown>
  outputText: string
  label?: string
  subject?: string
  detailsUnavailable?: boolean
  spilled?: boolean
}): GenericToolDetail {
  let title =
    args.label ??
    (() => {
      try {
        return describeToolCall(args.toolName, args.input)
      } catch {
        return prettifyName(args.toolName)
      }
    })()
  if (args.subject && !title.includes(args.subject)) {
    title = `${prettifyName(args.toolName)} · ${args.subject}`
  }
  if (args.detailsUnavailable) {
    return {
      title,
      detailsUnavailable: true,
      subtitle: 'Details unavailable for this run',
    }
  }
  let inputJson: string | undefined
  try {
    inputJson = truncate(
      JSON.stringify(args.input ?? {}, null, 2),
      GENERIC_JSON_MAX_CHARS,
    )
  } catch {
    inputJson = undefined
  }
  return {
    title,
    inputJson,
    outputText: truncate(args.outputText || '', GENERIC_JSON_MAX_CHARS),
    spilled: args.spilled === true ? true : undefined,
  }
}
