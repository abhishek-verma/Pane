import {
  fitsPreviewBudget,
  previewJson,
} from '@browseros/shared/tool-input-preview'

/** Per-response wire window. Background/model stream remains untouched. */
export function createLiveUiWindow() {
  const tools = new Set<string>()
  const texts = new Map<string, number>()
  const previewedInputs = new Set<string>()
  let textRemaining = 64_000
  let extraParts = 0
  let marked = false
  const marker = () => ({
    type: 'data-pane-content-preview',
    id: 'pane-content-preview',
    data: { inputPreviewIds: [...previewedInputs] },
  })
  const omit = () => {
    if (marked) return []
    marked = true
    return [marker()]
  }
  const admitTool = (id: unknown): id is string => {
    if (typeof id !== 'string' || id.length > 256) return false
    if (tools.has(id)) return true
    if (tools.size >= 48) return false
    tools.add(id)
    return true
  }
  const project = (
    chunk: Record<string, unknown>,
  ): Record<string, unknown>[] => {
    const type = String(chunk.type)
    const id = String(chunk.id ?? '')
    if (type === 'start') {
      tools.clear()
      texts.clear()
      previewedInputs.clear()
      textRemaining = 64_000
      extraParts = 0
      marked = false
      const { messageMetadata, ...rest } = chunk
      return [fitsPreviewBudget(messageMetadata, 2048) ? chunk : rest]
    }
    if (type === 'text-start' || type === 'reasoning-start') {
      if (texts.size >= 32 || id.length > 256) return omit()
      texts.set(id, type === 'reasoning-start' ? 16_000 : 64_000)
      return [chunk]
    }
    if (type === 'text-delta' || type === 'reasoning-delta') {
      if (!texts.has(id)) return omit()
      const original = typeof chunk.delta === 'string' ? chunk.delta : ''
      const delta = original.slice(
        0,
        Math.min(textRemaining, texts.get(id) ?? 0),
      )
      textRemaining -= delta.length
      texts.set(id, (texts.get(id) ?? 0) - delta.length)
      const clipped = delta.length !== original.length
      return [
        ...(clipped ? omit() : []),
        ...(delta ? [{ ...chunk, delta }] : []),
      ]
    }
    if (type === 'text-end' || type === 'reasoning-end')
      return texts.has(id) ? [chunk] : []
    // Do not accumulate a second, arbitrarily large JSON argument string in the
    // SDK. The complete input-available frame supplies the bounded preview.
    if (type === 'tool-input-delta') return []
    if (
      type === 'tool-input-start' ||
      type === 'tool-input-available' ||
      type === 'tool-input-error'
    ) {
      if (!admitTool(chunk.toolCallId)) return omit()
      if (type === 'tool-input-start' || fitsPreviewBudget(chunk.input, 2048))
        return [chunk]
      previewedInputs.add(String(chunk.toolCallId))
      marked = true
      const input = {
        preview: JSON.stringify(previewJson(chunk.input)).slice(0, 256),
      }
      return [marker(), { ...chunk, input }]
    }
    if (type.startsWith('tool-')) {
      if (!tools.has(String(chunk.toolCallId))) return omit()
      if (
        type === 'tool-output-available' &&
        !fitsPreviewBudget(chunk.output, 4000)
      ) {
        const output = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(previewJson(chunk.output)).slice(0, 500),
            },
          ],
          contentLength: 1,
        }
        return [...omit(), { ...chunk, output }]
      }
      if (typeof chunk.errorText === 'string' && chunk.errorText.length > 512)
        return [
          ...omit(),
          { ...chunk, errorText: chunk.errorText.slice(0, 512) },
        ]
      return [chunk]
    }
    if (
      type === 'message-metadata' &&
      !fitsPreviewBudget(chunk.messageMetadata, 2048)
    )
      return omit()
    if (
      type.startsWith('data-') ||
      type === 'file' ||
      type.startsWith('source-') ||
      type === 'start-step'
    ) {
      if (++extraParts > 16 || !fitsPreviewBudget(chunk, 2048)) return omit()
    }
    return [chunk]
  }
  return (chunk: Record<string, unknown>): Record<string, unknown>[] =>
    project(chunk).map((part) => {
      let result = part
      for (const key of [
        'providerMetadata',
        'toolMetadata',
        'rawInput',
        'messageMetadata',
        'title',
      ]) {
        if (fitsPreviewBudget(part[key], 512)) continue
        if (result === part) result = { ...part }
        delete result[key]
      }
      if (typeof result.errorText === 'string' && result.errorText.length > 512)
        result = { ...result, errorText: result.errorText.slice(0, 512) }
      return result
    })
}
