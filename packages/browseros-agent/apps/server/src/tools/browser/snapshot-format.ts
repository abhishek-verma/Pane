import { writeTempToolOutputFile } from './output-file'
import { wrapUntrusted } from './trust-boundary'

const LARGE_SNAPSHOT_WORD_THRESHOLD = 15_000
const LARGE_SNAPSHOT_CHAR_THRESHOLD = 50_000
const MAX_SAVE_FAILURE_EXCERPT_CHARS = 4_000

export interface FormattedSnapshot {
  text: string
  structured?: Record<string, unknown>
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** Formats page snapshots for direct tools and automatic post-action readback. */
export async function formatSnapshotResult(
  snapshot: string,
  origin: string,
): Promise<FormattedSnapshot> {
  const snapshotText = snapshot || '(empty page)'
  const wordCount = countWords(snapshot)
  const wrappedSnapshot = wrapUntrusted(snapshotText, origin)
  const contentLength = wrappedSnapshot.length

  if (
    wordCount > LARGE_SNAPSHOT_WORD_THRESHOLD ||
    snapshotText.length > LARGE_SNAPSHOT_CHAR_THRESHOLD
  ) {
    try {
      const path = await writeTempToolOutputFile({
        toolName: 'snapshot',
        extension: 'md',
        content: wrappedSnapshot,
      })

      return {
        text: [
          `Large snapshot (${wordCount} words, ${contentLength} chars) saved to: ${path}`,
          'Read the file for the full snapshot and refs.',
        ].join('\n'),
        structured: {
          path,
          contentLength,
          wordCount,
          writtenToFile: true,
        },
      }
    } catch (error) {
      const saveError = error instanceof Error ? error.message : String(error)
      const excerpt = snapshotText.slice(0, MAX_SAVE_FAILURE_EXCERPT_CHARS)
      return {
        text: [
          `Large snapshot (${wordCount} words, ${contentLength} chars) could not be saved to a BrowserOS output file: ${saveError}`,
          `Showing the first ${excerpt.length} chars instead:`,
          wrapUntrusted(excerpt, origin),
        ].join('\n'),
        structured: {
          contentLength,
          wordCount,
          writtenToFile: false,
          outputWriteFailed: true,
          error: saveError,
        },
      }
    }
  }

  return { text: wrappedSnapshot }
}
