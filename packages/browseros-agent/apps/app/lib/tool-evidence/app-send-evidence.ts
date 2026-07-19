import { APP_SEND_SUMMARY_MAX_CHARS, type AppSendDetail } from './types'

function prettifyName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
}

function firstString(
  input: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = input[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export function buildAppSendDetail(args: {
  toolName: string
  input: Record<string, unknown>
  outputText: string
  label?: string
  subject?: string
}): AppSendDetail {
  const server = firstString(args.input, [
    'server_name',
    'server',
    'app',
    'provider',
  ])
  const action = firstString(args.input, [
    'action_name',
    'action',
    'name',
    'subject',
    'title',
  ])
  const destination = firstString(args.input, [
    'to',
    'destination',
    'channel',
    'recipient',
    'email',
    'address',
    'server_name',
    'server',
  ])

  let title = args.label
  if (!title) {
    if (server && action) title = `${server} · ${action}`
    else if (action) title = action
    else if (server) title = `Sent via ${server}`
    else title = prettifyName(args.toolName)
  }
  if (args.subject && !title.includes(args.subject)) {
    title = `${title} · ${args.subject}`
  }

  const summary = args.outputText
    ? truncate(
        args.outputText.replace(/\s+/g, ' ').trim(),
        APP_SEND_SUMMARY_MAX_CHARS,
      )
    : undefined

  return {
    title,
    destination,
    summary,
  }
}
