import type { BrowserActionDetail, StrippedMedia, ToolMedia } from './types'

const KIND_VERBS: Record<string, string> = {
  click: 'Clicked',
  click_at: 'Clicked',
  type: 'Typed',
  type_at: 'Typed',
  fill: 'Filled',
  press: 'Pressed',
  hover: 'Hovered',
  focus: 'Focused',
  check: 'Checked',
  uncheck: 'Unchecked',
  select: 'Selected',
  scroll: 'Scrolled',
  drag: 'Dragged',
  drag_at: 'Dragged',
}

function hostnameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

export function buildActCaption(input: Record<string, unknown>): string {
  const kind = typeof input.kind === 'string' ? input.kind : 'act'
  const verb = KIND_VERBS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
  const text = typeof input.text === 'string' ? input.text : undefined
  const value = typeof input.value === 'string' ? input.value : undefined
  const key = typeof input.key === 'string' ? input.key : undefined
  const ref = typeof input.ref === 'string' ? input.ref : undefined
  const selector =
    typeof input.selector === 'string' ? input.selector : undefined

  if (kind === 'type' || kind === 'type_at') {
    if (text) return `${verb} ${quote(text.slice(0, 40))}`
  }
  if (kind === 'fill' || kind === 'select') {
    if (value) return `${verb} ${quote(value.slice(0, 40))}`
  }
  if (kind === 'press' && key) return `${verb} ${key}`
  if (text) return `${verb} ${quote(text.slice(0, 60))}`
  if (value) return `${verb} ${quote(value.slice(0, 60))}`
  if (ref) return `${verb} ${ref}`
  if (selector) return `${verb} ${selector}`
  return verb
}

export function buildNavigateCaption(input: Record<string, unknown>): string {
  const action = typeof input.action === 'string' ? input.action : 'url'
  if (action === 'url' && typeof input.url === 'string') {
    return `Navigated to ${input.url}`
  }
  if (action === 'back') return 'Navigated back'
  if (action === 'forward') return 'Navigated forward'
  if (action === 'reload') return 'Reloaded page'
  return 'Navigated'
}

export function buildPageDiffSummary(args: {
  structured: Record<string, unknown> | null
  text: string
}): string | undefined {
  const s = args.structured
  if (s) {
    if (s.changed === false) return 'No page change'
    const parts: string[] = []
    if (s.urlChanged === true) {
      const after =
        typeof s.afterUrl === 'string'
          ? s.afterUrl
          : typeof s.url === 'string'
            ? s.url
            : undefined
      if (after) parts.push(`URL → ${after}`)
      else parts.push('URL changed')
    }
    const added = typeof s.added === 'number' ? s.added : undefined
    const removed = typeof s.removed === 'number' ? s.removed : undefined
    if (added != null || removed != null) {
      parts.push(`+${added ?? 0}/−${removed ?? 0} nodes`)
    }
    if (parts.length) return parts.join(' · ')
  }

  if (args.text.includes('no change since last snapshot')) {
    return 'No page change'
  }
  const pageDiff = args.text.match(
    /\[Page\s+\d+\s+diff\]\n([\s\S]*?)(?:\n\[Page|\n---|\s*$)/,
  )
  if (pageDiff?.[1]) {
    const snippet = pageDiff[1].trim().split('\n').slice(0, 2).join(' ')
    if (snippet) return snippet.slice(0, 160)
  }
  return undefined
}

export function buildBrowserActionDetail(args: {
  toolName: string
  input: Record<string, unknown>
  outputText: string
  structured: Record<string, unknown> | null
  images: ToolMedia[]
  strippedImages?: StrippedMedia[]
}): BrowserActionDetail {
  const url =
    (typeof args.structured?.afterUrl === 'string'
      ? args.structured.afterUrl
      : undefined) ??
    (typeof args.structured?.url === 'string'
      ? args.structured.url
      : undefined) ??
    (typeof args.input.url === 'string' ? args.input.url : undefined)

  let caption: string
  if (args.toolName === 'screenshot') {
    const host = hostnameFromUrl(url)
    caption = host ? `Screenshot · ${host}` : 'Screenshot'
  } else if (args.toolName === 'navigate') {
    caption = buildNavigateCaption(args.input)
  } else if (args.toolName === 'upload') {
    caption = 'Uploaded file'
  } else if (args.toolName === 'download') {
    caption = 'Downloaded file'
  } else {
    caption = buildActCaption(args.input)
  }

  const hostname = hostnameFromUrl(url)
  if (hostname && args.toolName === 'act') {
    caption = `${caption} · ${hostname}`
  }

  return {
    caption,
    hostname,
    url,
    pageDiffSummary: buildPageDiffSummary({
      structured: args.structured,
      text: args.outputText,
    }),
    media: args.images,
    ...(args.strippedImages && args.strippedImages.length > 0
      ? { strippedImages: args.strippedImages }
      : {}),
  }
}
