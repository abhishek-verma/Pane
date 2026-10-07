import {
  fitsPreviewBudget,
  measuredSize,
  previewJson,
} from './tool-input-preview'

export const UI_TRANSCRIPT_BYTES = 1_000_000
export const UI_MESSAGE_PARTS = 128
export const UI_RESIDENT_MESSAGES = 60
export const UI_TEXT_CHARS = 64_000
export const UI_REASONING_CHARS = 16_000

type Part = { type: string; [key: string]: unknown }
type Message = { id: string; role: string; parts: { type: string }[] }
export type ContentPreview = {
  totalParts: number
  pendingApprovalsOmitted: boolean
}

export function contentPreview(message: unknown): ContentPreview | undefined {
  const value = (message as { uiContentPreview?: ContentPreview })
    ?.uiContentPreview
  if (value) return value
  // The live SSE limiter uses a data part because AI SDK owns the message shell.
  const parts = (message as Message)?.parts
  if (parts?.some((part) => part.type === 'data-pane-content-preview'))
    return { totalParts: parts.length, pendingApprovalsOmitted: false }
  return undefined
}

export function hasEarlierUiMessages(messages: Message[]): boolean {
  return Boolean(
    (messages[0] as Message & { uiHistoryBefore?: boolean })?.uiHistoryBefore,
  )
}

function measuredPart(part: Part, role: string): Part {
  return role === 'user' && part.type === 'file'
    ? { ...part, url: '[attachment]' }
    : part
}

function plainText(part: Part, budget: number): Part {
  const text = String(part.text ?? '')
  const cap = part.type === 'reasoning' ? UI_REASONING_CHARS : UI_TEXT_CHARS
  let end = Math.min(text.length, cap)
  const plain = {
    type: part.type,
    text: text.slice(0, end),
    ...(part.state ? { state: part.state } : {}),
  }
  if (!fitsPreviewBudget(plain, budget - 64)) {
    let low = 0
    let high = end
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (
        fitsPreviewBudget({ ...plain, text: text.slice(0, mid) }, budget - 64)
      )
        low = mid
      else high = mid - 1
    }
    end = low
  }
  return {
    ...plain,
    text: text.slice(0, end),
    ...(end < text.length || part.uiTextPreviewed
      ? { uiTextPreviewed: true }
      : {}),
  }
}

/** Pure bounded projection. No serialization/copy of the oversized source. */
function fitPart(part: Part, role: string, budget: number): Part | undefined {
  if (budget < 128) return undefined
  if (
    (part.type === 'text' || part.type === 'reasoning') &&
    typeof part.text === 'string'
  ) {
    const cap = part.type === 'reasoning' ? UI_REASONING_CHARS : UI_TEXT_CHARS
    if (part.text.length <= cap && fitsPreviewBudget(part, budget)) return part
    return plainText(part, budget)
  }
  if (fitsPreviewBudget(measuredPart(part, role), budget)) return part
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-'))
    return undefined
  const inputFits = fitsPreviewBudget(part.input, Math.min(16_000, budget / 3))
  let input = inputFits ? part.input : previewJson(part.input)
  if (!fitsPreviewBudget(input, budget / 3))
    input = { preview: 'Load full parameters to inspect.' }
  const outputFits = fitsPreviewBudget(part.output, Math.min(8000, budget / 3))
  const compact: Part = {
    type: part.type,
    toolCallId: part.toolCallId,
    state: part.state,
    ...(part.type === 'dynamic-tool' ? { toolName: part.toolName } : {}),
    ...(part.approval ? { approval: part.approval } : {}),
    input,
    ...(part.inputPreviewed || !inputFits ? { inputPreviewed: true } : {}),
    ...(part.output !== undefined
      ? {
          output: outputFits
            ? part.output
            : {
                content: [
                  {
                    type: 'text',
                    text: 'Load full details to inspect this result.',
                  },
                ],
                contentLength: 1,
              },
        }
      : {}),
    ...(part.errorText
      ? { errorText: String(part.errorText).slice(0, 256) }
      : {}),
  }
  return fitsPreviewBudget(compact, budget) ? compact : undefined
}

function priority(part: Part): number {
  if (
    part.state === 'approval-requested' ||
    part.state === 'approval-responded'
  )
    return 0
  if (part.type === 'text') return 1
  if (part.type === 'reasoning') return 2
  return 3
}

/** Bound both retained bytes and part count BEFORE useChat/segment processing.
 * Ordinary replies get space before trace details. Overflow is represented once
 * by uiContentPreview and remains available through the paged content endpoint.
 * Validated user attachments have independent upload limits and are exempt.
 */
export function boundUiTranscript<T extends Message>(messages: T[]): T[] {
  if (!messages.length) return messages
  const resident =
    messages.length > UI_RESIDENT_MESSAGES
      ? messages.slice(-UI_RESIDENT_MESSAGES)
      : messages
  const messageBudget = Math.floor(
    (UI_TRANSCRIPT_BYTES - 1024) / resident.length,
  )
  let changed = resident !== messages
  const result = resident.map((message, messageIndex) => {
    const source = message as T & {
      uiContentPreview?: ContentPreview
      uiHistoryBefore?: boolean
      metadata?: unknown
    }
    const parts = message.parts as Part[]
    let hasInputMarker = false
    let markerCount = 0
    let existingMarker: Part | undefined
    let requiresFullInputReview = false
    // Replays can contain several revisions of the same data marker. Never
    // trust only the first (text overflow may precede an input preview).
    for (const part of parts) {
      if (part.type !== 'data-pane-content-preview') continue
      hasInputMarker = true
      markerCount++
      existingMarker ??= part
      const data = part.data as
        | { inputPreviewIds?: unknown; inputPreviewed?: boolean }
        | undefined
      // Keep this sticky even when the marker arrives BEFORE input-available.
      // IDs cannot be discarded merely because their tool part is not present
      // in this intermediate SDK snapshot yet. One conservative bit bounds
      // memory and requires an authoritative load for this turn's approvals.
      requiresFullInputReview ||=
        data?.inputPreviewed === true ||
        (Array.isArray(data?.inputPreviewIds) &&
          data.inputPreviewIds.length > 0)
    }
    const selected = new Set<number>()
    // Four bounded selections avoid allocating an index for every source part.
    for (let rank = 0; rank < 4 && selected.size < UI_MESSAGE_PARTS; rank++) {
      for (
        let index = parts.length - 1;
        index >= 0 && selected.size < UI_MESSAGE_PARTS;
        index--
      ) {
        if (
          parts[index].type !== 'data-pane-content-preview' &&
          priority(parts[index]) === rank
        )
          selected.add(index)
      }
    }
    let remaining = messageBudget - 5120
    const kept = new Map<number, Part>()
    let previewed = Boolean(source.uiContentPreview || hasInputMarker)
    let pendingApprovalsOmitted =
      source.uiContentPreview?.pendingApprovalsOmitted ?? false
    let partsChanged = selected.size !== parts.length - markerCount
    for (const index of selected) {
      const original = parts[index]
      const part =
        requiresFullInputReview &&
        (original.type === 'dynamic-tool' ||
          original.type.startsWith('tool-')) &&
        !original.inputPreviewed
          ? { ...original, inputPreviewed: true }
          : original
      const next = fitPart(part, message.role, remaining)
      if (!next) {
        partsChanged = true
        previewed = true
        pendingApprovalsOmitted ||= priority(part) === 0
        continue
      }
      const bytes = measuredSize(measuredPart(next, message.role), remaining)
      if (!Number.isFinite(bytes)) {
        partsChanged = true
        previewed = true
        continue
      }
      remaining -= bytes + 2
      kept.set(index, next)
      partsChanged ||= next !== original
      previewed ||= Boolean(next.uiTextPreviewed)
    }
    if (kept.size !== parts.length - markerCount) {
      previewed = true
      if (!pendingApprovalsOmitted)
        pendingApprovalsOmitted = parts.some(
          (part, index) => priority(part) === 0 && !kept.has(index),
        )
    }
    const totalParts =
      source.uiContentPreview?.totalParts ??
      (existingMarker?.data as { totalParts?: number })?.totalParts ??
      parts.length - markerCount
    if (previewed) {
      if (kept.size === UI_MESSAGE_PARTS) {
        const lastPriority = [...kept.keys()].at(-1)
        if (lastPriority !== undefined) {
          pendingApprovalsOmitted ||= priority(parts[lastPriority]) === 0
          kept.delete(lastPriority)
          partsChanged = true
        }
      }
      const markerData = existingMarker?.data as
        | {
            totalParts?: number
            inputPreviewIds?: unknown
            inputPreviewed?: boolean
          }
        | undefined
      const markerStable =
        markerCount === 1 &&
        markerData?.totalParts === totalParts &&
        !markerData.inputPreviewIds &&
        Boolean(markerData.inputPreviewed) === requiresFullInputReview
      const marker = markerStable
        ? existingMarker!
        : {
            type: 'data-pane-content-preview',
            id: 'pane-content-preview',
            data: {
              totalParts,
              ...(requiresFullInputReview ? { inputPreviewed: true } : {}),
            },
          }
      kept.set(parts.length, marker)
      partsChanged ||= !markerStable
    }
    const historyBefore = Boolean(
      (messageIndex === 0 && resident !== messages) || source.uiHistoryBefore,
    )
    const metadataFits = fitsPreviewBudget(source.metadata, 4096)
    const shellFits = fitsPreviewBudget({ ...source, parts: [] }, 5120)
    if (
      !partsChanged &&
      metadataFits &&
      shellFits &&
      historyBefore === Boolean(source.uiHistoryBefore)
    )
      return message
    changed = true
    return {
      id: message.id,
      role: message.role,
      parts: [...kept.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, part]) => part),
      ...(metadataFits && source.metadata !== undefined
        ? { metadata: source.metadata }
        : {}),
      ...(historyBefore ? { uiHistoryBefore: true } : {}),
      ...(previewed
        ? { uiContentPreview: { totalParts, pendingApprovalsOmitted } }
        : {}),
    } as T
  })
  return changed ? result : messages
}
