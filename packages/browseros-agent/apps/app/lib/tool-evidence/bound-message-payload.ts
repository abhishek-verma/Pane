import {
  fitsPreviewBudget,
  previewToolInput,
} from '@browseros/shared/tool-input-preview'
import { boundUiTranscript } from '@browseros/shared/ui-transcript-window'
import type { UIMessage } from 'ai'

/** Bound resident state before traversing tool payloads; overflow is paged.
 * Rendering is windowed within turns; full tool details are loaded on demand.
 * Previewed approval arguments are never executable; the approval UI loads the
 * authoritative input first. The server transcript remains untouched.
 */
export function boundMessagePayload(messages: UIMessage[]): UIMessage[] {
  const resident = boundUiTranscript(messages)
  let changed = resident !== messages
  const next = resident.map((message) => {
    let partsChanged = false
    const parts = message.parts.map((part) => {
      let next = previewToolInput(part)
      if (
        'providerMetadata' in next &&
        !fitsPreviewBudget(next.providerMetadata, 4096)
      ) {
        const { providerMetadata: _metadata, ...rest } = next
        next = rest as typeof part
      }
      if (next !== part) partsChanged = true
      return next
    })
    const metadataFits = fitsPreviewBudget(message.metadata, 4096)
    if (!partsChanged && metadataFits) return message
    changed = true
    const { metadata, ...rest } = message
    return { ...rest, parts, ...(metadataFits ? { metadata } : {}) }
  })
  return changed ? next : messages
}
